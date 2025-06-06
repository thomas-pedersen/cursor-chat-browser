import { NextResponse } from "next/server"
import path from 'path'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import { ChatBubble, ChatTab, ComposerData } from "@/types/workspace"
import { resolveWorkspacePath } from '@/utils/workspace-path'

interface RawTab {
  tabId: string;
  chatTitle: string;
  lastSendTime: number;
  bubbles: ChatBubble[];
}

const safeParseTimestamp = (timestamp: number | undefined): string => {
  try {
    if (!timestamp) {
      return new Date().toISOString();
    }
    return new Date(timestamp).toISOString();
  } catch (error) {
    console.error('Error parsing timestamp:', error, 'Raw value:', timestamp);
    return new Date().toISOString();
  }
};

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const workspacePath = resolveWorkspacePath()
    const dbPath = path.join(workspacePath, params.id, 'state.vscdb')

    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    })

    const chatResult = await db.get(`
      SELECT value FROM ItemTable
      WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'
    `)

    const composerResult = await db.get(`
      SELECT value FROM ItemTable
      WHERE [key] = 'composer.composerData'
    `)

    await db.close()

    if (!chatResult && !composerResult) {
      return NextResponse.json({ error: 'No chat data found' }, { status: 404 })
    }

    const response: { tabs: ChatTab[], composers?: ComposerData } = { tabs: [] }

    if (chatResult) {
      const chatData = JSON.parse(chatResult.value)
      response.tabs = chatData.tabs.map((tab: RawTab) => ({
        id: tab.tabId,
        title: tab.chatTitle?.split('\n')[0] || `Chat ${tab.tabId.slice(0, 8)}`,
        timestamp: safeParseTimestamp(tab.lastSendTime),
        bubbles: tab.bubbles
      }))
    }

    if (composerResult) {
      const globalDbPath = path.join(workspacePath, '..', 'globalStorage', 'state.vscdb')
      const composers: ComposerData = JSON.parse(composerResult.value)
      const keys = composers.allComposers.map((it) => `composerData:${it.composerId}`)
      const placeholders = keys.map(() => '?').join(',')

      const globalDb = await open({
        filename: globalDbPath,
        driver: sqlite3.Database
      })

      const composersBodyResult = await globalDb.all(`
        SELECT value FROM cursorDiskKV
        WHERE [key] in (${placeholders})
      `, keys)

      await globalDb.close()

      if (composersBodyResult) {
        composers.allComposers = composersBodyResult.map((it) => JSON.parse(it.value))
        response.composers = composers
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Failed to get workspace data:', error)
    return NextResponse.json({ error: 'Failed to get workspace data' }, { status: 500 })
  }
}
