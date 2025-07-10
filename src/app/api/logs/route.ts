import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import Database from 'better-sqlite3'
import { resolveWorkspacePath } from '@/utils/workspace-path'
import { ChatTab, ComposerChat } from '@/types/workspace'

interface WorkspaceLog {
  id: string;
  workspaceId: string;
  workspaceFolder?: string;
  title: string;
  timestamp: number;
  type: 'chat' | 'composer';
  messageCount: number;
}

function extractChatIdFromBubbleKey(key: string): string | null {
  // key format: bubbleId:<chatId>:<bubbleId>
  const match = key.match(/^bubbleId:([^:]+):/)
  return match ? match[1] : null
}

export async function GET() {
  try {
    const workspacePath = resolveWorkspacePath()
    const logs: WorkspaceLog[] = []
    
    // Check global storage for chat data (new Cursor format)
    const globalDbPath = path.join(workspacePath, '..', 'globalStorage', 'state.vscdb')
    if (existsSync(globalDbPath)) {
      try {
        const globalDb = new Database(globalDbPath, { readonly: true })
        // Get all bubbleId keys
        const bubbleRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'").all()
        // Map: chatId -> array of bubbles
        const chatMap: Record<string, any[]> = {}
        for (const rowUntyped of bubbleRows) {
          const row = rowUntyped as { key: string, value: string }
          const chatId = extractChatIdFromBubbleKey(row.key)
          if (!chatId) continue
          try {
            const bubble = JSON.parse(row.value)
            if (!chatMap[chatId]) chatMap[chatId] = []
            chatMap[chatId].push(bubble)
          } catch {}
        }
        for (const chatId of Object.keys(chatMap)) {
          let bubbles = chatMap[chatId]
          // Filter out null/undefined bubbles
          bubbles = bubbles.filter(b => b && typeof b === 'object')
          if (!bubbles.length) {
            console.warn(`Skipping chatId ${chatId} because it has no valid bubbles`)
            continue
          }
          // Sort by timestamp if available, fallback to order
          bubbles.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
          const first = bubbles[0]
          const last = bubbles[bubbles.length - 1]
          if (!first || !last) {
            console.warn(`Skipping chatId ${chatId} because first or last bubble is null`)
            continue
          }
          logs.push({
            id: chatId,
            workspaceId: 'global',
            workspaceFolder: undefined,
            title: first.text?.split('\n')[0] || `Chat ${chatId.slice(0, 8)}`,
            timestamp: last.timestamp || Date.now(),
            type: 'chat',
            messageCount: bubbles.length
          })
        }
        globalDb.close()
      } catch (error) {
        console.error('Error reading global storage:', error)
      }
    }
    
    // Old logic for workspaceStorage (legacy Cursor)
    const entries = await fs.readdir(workspacePath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dbPath = path.join(workspacePath, entry.name, 'state.vscdb')
        const workspaceJsonPath = path.join(workspacePath, entry.name, 'workspace.json')
        if (!existsSync(dbPath)) continue
        let workspaceFolder = undefined
        try {
          const workspaceData = JSON.parse(await fs.readFile(workspaceJsonPath, 'utf-8'))
          workspaceFolder = workspaceData.folder
        } catch {}
        const db = new Database(dbPath, { readonly: true })
        // Get chat logs from workspace storage (for older chats)
        const chatResult = db.prepare(`SELECT value FROM ItemTable WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'`).get()
        if (chatResult && (chatResult as any).value) {
          const chatData = JSON.parse((chatResult as any).value)
          if (chatData.tabs && Array.isArray(chatData.tabs)) {
            const chatLogs = chatData.tabs.map((tab: ChatTab) => ({
              id: tab.id || '',
              workspaceId: entry.name,
              workspaceFolder,
              title: tab.title || `Chat ${(tab.id || '').slice(0, 8)}`,
              timestamp: new Date(tab.timestamp).getTime(),
              type: 'chat' as const,
              messageCount: tab.bubbles?.length || 0
            }))
            logs.push(...chatLogs)
          }
        }
        // Get composer logs
        const composerResult = db.prepare(`SELECT value FROM ItemTable WHERE [key] = 'composer.composerData'`).get()
        if (composerResult && (composerResult as any).value) {
          const composerData = JSON.parse((composerResult as any).value)
          if (composerData.allComposers && Array.isArray(composerData.allComposers)) {
            const composerLogs = composerData.allComposers.map((composer: ComposerChat) => ({
              id: composer.composerId || '',
              workspaceId: entry.name,
              workspaceFolder,
              title: composer.text || `Composer ${(composer.composerId || '').slice(0, 8)}`,
              timestamp: composer.lastUpdatedAt || composer.createdAt || Date.now(),
              type: 'composer' as const,
              messageCount: composer.conversation?.length || 0
            }))
            logs.push(...composerLogs)
          }
        }
        db.close()
      }
    }
    // Sort all logs by timestamp, newest first
    logs.sort((a, b) => b.timestamp - a.timestamp)
    return NextResponse.json({ logs })
  } catch (error) {
    console.error('Failed to get logs:', error)
    return NextResponse.json({ error: 'Failed to get logs', logs: [] }, { status: 500 })
  }
} 