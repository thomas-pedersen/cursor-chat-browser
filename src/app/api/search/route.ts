import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import Database from 'better-sqlite3'
import { resolveWorkspacePath } from '@/utils/workspace-path'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')
    const type = searchParams.get('type') || 'all'

    if (!query) {
      return NextResponse.json({ error: 'No search query provided' }, { status: 400 })
    }

    const workspacePath = resolveWorkspacePath()
    const results = []

    // Search global storage for chat data first
    const globalDbPath = path.join(workspacePath, '..', 'globalStorage', 'state.vscdb')
    if (existsSync(globalDbPath) && (type === 'all' || type === 'chat')) {
      try {
        const globalDb = new Database(globalDbPath, { readonly: true })
        const globalChatResult = globalDb.prepare(`
          SELECT value FROM ItemTable 
          WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'
        `).get()

        if (globalChatResult && (globalChatResult as any).value) {
          const chatData = JSON.parse((globalChatResult as any).value)
          for (const tab of chatData.tabs) {
            let hasMatch = false
            let matchingText = ''

            // Search in chat title
            if (tab.chatTitle?.toLowerCase().includes(query.toLowerCase())) {
              hasMatch = true
              matchingText = tab.chatTitle
            }

            // Search in bubbles
            for (const bubble of tab.bubbles) {
              if (bubble.text?.toLowerCase().includes(query.toLowerCase())) {
                hasMatch = true
                matchingText = bubble.text
                break
              }
            }

            if (hasMatch) {
              results.push({
                workspaceId: 'global',
                workspaceFolder: undefined,
                chatId: tab.tabId,
                chatTitle: tab.chatTitle || `Chat ${tab.tabId?.substring(0, 8) || 'Untitled'}`,
                timestamp: tab.lastSendTime || new Date().toISOString(),
                matchingText,
                type: 'chat'
              })
            }
          }
        }
        globalDb.close()
      } catch (error) {
        console.error('Error searching global storage:', error)
      }
    }

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
        } catch (error) {
          console.log(`No workspace.json found for ${entry.name}`)
        }

        try {
          const db = new Database(dbPath, { readonly: true })

          // Search chat logs if type is 'all' or 'chat'
          if (type === 'all' || type === 'chat') {
            const chatResult = db.prepare(`
              SELECT value FROM ItemTable 
              WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'
            `).get()

            if (chatResult && (chatResult as any).value) {
              const chatData = JSON.parse((chatResult as any).value)
              for (const tab of chatData.tabs) {
                let hasMatch = false
                let matchingText = ''

                // Search in chat title
                if (tab.chatTitle?.toLowerCase().includes(query.toLowerCase())) {
                  hasMatch = true
                  matchingText = tab.chatTitle
                }

                // Search in bubbles
                for (const bubble of tab.bubbles) {
                  if (bubble.text?.toLowerCase().includes(query.toLowerCase())) {
                    hasMatch = true
                    matchingText = bubble.text
                    break
                  }
                }

                if (hasMatch) {
                  results.push({
                    workspaceId: entry.name,
                    workspaceFolder,
                    chatId: tab.tabId,
                    chatTitle: tab.chatTitle || `Chat ${tab.tabId?.substring(0, 8) || 'Untitled'}`,
                    timestamp: tab.lastSendTime || new Date().toISOString(),
                    matchingText,
                    type: 'chat'
                  })
                }
              }
            }
          }

          // Search composer logs if type is 'all' or 'composer'
          if (type === 'all' || type === 'composer') {
            const composerResult = db.prepare(`
              SELECT value FROM ItemTable 
              WHERE [key] = 'composer.composerData'
            `).get()

            if (composerResult && (composerResult as any).value) {
              const composerData = JSON.parse((composerResult as any).value)
              for (const composer of composerData.allComposers) {
                let hasMatch = false
                let matchingText = ''

                // Search in composer text/title
                if (composer.text?.toLowerCase().includes(query.toLowerCase())) {
                  hasMatch = true
                  matchingText = composer.text
                }

                // Search in conversation
                if (Array.isArray(composer.conversation)) {
                  for (const message of composer.conversation) {
                    if (message.text?.toLowerCase().includes(query.toLowerCase())) {
                      hasMatch = true
                      matchingText = message.text
                      break
                    }
                  }
                }

                if (hasMatch) {
                  results.push({
                    workspaceId: entry.name,
                    workspaceFolder,
                    chatId: composer.composerId,
                    chatTitle: composer.text || `Composer ${composer.composerId.substring(0, 8)}`,
                    timestamp: composer.lastUpdatedAt || composer.createdAt || new Date().toISOString(),
                    matchingText,
                    type: 'composer'
                  })
                }
              }
            }
          }

          db.close()
        } catch (error) {
          console.error(`Error processing workspace ${entry.name}:`, error)
        }
      }
    }

    // Sort results by timestamp, newest first
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Search failed:', error)
    return NextResponse.json({ error: 'Search failed', results: [] }, { status: 500 })
  }
} 