import { NextResponse } from "next/server"
import path from 'path'
import fs from 'fs/promises'
import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { resolveWorkspacePath } from '@/utils/workspace-path'

export async function GET() {
  try {
    const workspacePath = resolveWorkspacePath()
    const workspaces = []
    
    const entries = await fs.readdir(workspacePath, { withFileTypes: true })
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dbPath = path.join(workspacePath, entry.name, 'state.vscdb')
        const workspaceJsonPath = path.join(workspacePath, entry.name, 'workspace.json')
        
        // Skip if state.vscdb doesn't exist
        if (!existsSync(dbPath)) {
          console.log(`Skipping ${entry.name}: no state.vscdb found`)
          continue
        }
        
        try {
          const stats = await fs.stat(dbPath)
          const db = new Database(dbPath, { readonly: true })
          const result = db.prepare(`
            SELECT value FROM ItemTable 
            WHERE [key] IN ('workbench.panel.aichat.view.aichat.chatdata')
          `).get()
          db.close()
          
          // Parse the chat data and count tabs
          let chatCount = 0
          if (result && (result as any).value) {
            try {
              const chatData = JSON.parse((result as any).value)
              chatCount = chatData.tabs?.length || 0
            } catch (error) {
              console.error('Error parsing chat data:', error)
            }
          }
          
          // Try to read workspace.json
          let folder = undefined
          try {
            const workspaceData = JSON.parse(await fs.readFile(workspaceJsonPath, 'utf-8'))
            folder = workspaceData.folder
          } catch (error) {
            console.log(`No workspace.json found for ${entry.name}`)
          }
          
          workspaces.push({
            id: entry.name,
            path: dbPath,
            folder: folder,
            lastModified: stats.mtime.toISOString(),
            chatCount: chatCount
          })
          
        } catch (error) {
          console.error(`Error processing workspace ${entry.name}:`, error)
        }
      }
    }
    
    return NextResponse.json(workspaces)
  } catch (error) {
    console.error('Failed to get workspaces:', error)
    return NextResponse.json({ error: 'Failed to get workspaces' }, { status: 500 })
  }
} 