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

export async function GET() {
  try {
    const workspacePath = resolveWorkspacePath()
    const logs: WorkspaceLog[] = []
    
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
        } catch {
          console.log(`No workspace.json found for ${entry.name}`)
        }

        const db = new Database(dbPath, { readonly: true })

        // Get chat logs
        const chatResult = db.prepare(`
          SELECT value FROM ItemTable 
          WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'
        `).get()

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
        const composerResult = db.prepare(`
          SELECT value FROM ItemTable 
          WHERE [key] = 'composer.composerData'
        `).get()

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