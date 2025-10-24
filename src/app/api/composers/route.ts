import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import Database from 'better-sqlite3'
import { ComposerChat, ComposerData } from '@/types/workspace'
import { resolveWorkspacePath } from '@/utils/workspace-path'

export async function GET() {
  try {
    const workspacePath = resolveWorkspacePath()
    const composers = []
    
    const entries = await fs.readdir(workspacePath, { withFileTypes: true })
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dbPath = path.join(workspacePath, entry.name, 'state.vscdb')
        const workspaceJsonPath = path.join(workspacePath, entry.name, 'workspace.json')
        
        if (!existsSync(dbPath)) continue

        // Get workspace folder info
        let workspaceFolder = undefined
        try {
          const workspaceData = JSON.parse(await fs.readFile(workspaceJsonPath, 'utf-8'))
          workspaceFolder = workspaceData.folder
        } catch (error) {
          console.log(`No workspace.json found for ${entry.name}`)
        }
        
        const db = new Database(dbPath, { readonly: true })
        const result = db.prepare(`
          SELECT value FROM ItemTable 
          WHERE [key] = 'composer.composerData'
        `).get()
        db.close()
        
        if (result && (result as any).value) {
          const composerData = JSON.parse((result as any).value) as ComposerData
          // Add workspace info to each composer and ensure conversation exists
          const composersWithWorkspace = composerData.allComposers.map(composer => ({
            ...composer,
            conversation: composer.conversation || [],  // Provide default empty array
            workspaceId: entry.name,
            workspaceFolder
          }))
          composers.push(...composersWithWorkspace)
        }
        
      }
    }

    // Sort by lastUpdatedAt before returning
    composers.sort((a: ComposerChat, b: ComposerChat) => {
      const aTime = a.lastUpdatedAt || 0
      const bTime = b.lastUpdatedAt || 0
      return bTime - aTime
    })
    
    return NextResponse.json(composers)
  } catch (error) {
    console.error('Failed to get composers:', error)
    return NextResponse.json({ error: 'Failed to get composers' }, { status: 500 })
  }
} 