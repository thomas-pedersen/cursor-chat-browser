import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import Database from 'better-sqlite3'
import { resolveWorkspacePath } from '@/utils/workspace-path'

interface SearchResult {
  workspaceId: string
  workspaceFolder: string | undefined
  chatId: string
  chatTitle: string
  timestamp: string | number
  matchingText: string
  type: 'chat' | 'composer'
}

function extractTextFromBubble(bubble: any): string {
  let text = ''
  
  if (bubble.text && bubble.text.trim()) {
    text = bubble.text
  }
  
  if (!text && bubble.richText) {
    try {
      const richTextData = JSON.parse(bubble.richText)
      if (richTextData.root && richTextData.root.children) {
        text = extractTextFromRichText(richTextData.root.children)
      }
    } catch (error) {
      // ignore parse errors
    }
  }
  
  return text
}

function extractTextFromRichText(children: any[]): string {
  let text = ''
  
  for (const child of children) {
    if (child.type === 'text' && child.text) {
      text += child.text
    } else if (child.children && Array.isArray(child.children)) {
      text += extractTextFromRichText(child.children)
    }
  }
  
  return text
}

function getProjectFromFilePath(filePath: string, workspaceEntries: Array<{name: string, workspaceJsonPath: string, folder: string}>): string | null {
  const normalizedPath = filePath.replace('file://', '')
  
  for (const entry of workspaceEntries) {
    if (entry.folder) {
      const workspacePath = entry.folder.replace('file://', '')
      if (normalizedPath.startsWith(workspacePath)) {
        return entry.name
      }
    }
  }
  return null
}

function determineProjectForConversation(
  composerData: any, 
  composerId: string,
  projectLayoutsMap: Record<string, string[]>,
  projectNameToWorkspaceId: Record<string, string>,
  workspaceEntries: Array<{name: string, workspaceJsonPath: string, folder: string}>,
  bubbleMap: Record<string, any>
): string | null {
  // First, try to get project from projectLayouts (most accurate)
  const projectLayouts = projectLayoutsMap[composerId] || []
  for (const projectName of projectLayouts) {
    const workspaceId = projectNameToWorkspaceId[projectName]
    if (workspaceId) {
      return workspaceId
    }
  }
  
  // Check newlyCreatedFiles
  if (composerData.newlyCreatedFiles && composerData.newlyCreatedFiles.length > 0) {
    for (const file of composerData.newlyCreatedFiles) {
      if (file.uri && file.uri.path) {
        const projectId = getProjectFromFilePath(file.uri.path, workspaceEntries)
        if (projectId) return projectId
      }
    }
  }
  
  // Check codeBlockData
  if (composerData.codeBlockData) {
    for (const filePath of Object.keys(composerData.codeBlockData)) {
      const projectId = getProjectFromFilePath(filePath, workspaceEntries)
      if (projectId) return projectId
    }
  }
  
  // Check file references in bubbles
  const conversationHeaders = composerData.fullConversationHeadersOnly || []
  for (const header of conversationHeaders) {
    const bubbleId = header.bubbleId
    const bubble = bubbleMap[bubbleId]
    
    if (bubble) {
      if (bubble.relevantFiles && Array.isArray(bubble.relevantFiles)) {
        for (const filePath of bubble.relevantFiles) {
          if (filePath) {
            const projectId = getProjectFromFilePath(filePath, workspaceEntries)
            if (projectId) return projectId
          }
        }
      }
      
      if (bubble.context && bubble.context.fileSelections && Array.isArray(bubble.context.fileSelections)) {
        for (const fileSelection of bubble.context.fileSelections) {
          if (fileSelection && fileSelection.uri && fileSelection.uri.path) {
            const projectId = getProjectFromFilePath(fileSelection.uri.path, workspaceEntries)
            if (projectId) return projectId
          }
        }
      }
    }
  }
  
  return null
}

export async function GET(request: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let globalDb: any = null
  
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')
    const type = searchParams.get('type') || 'all'

    if (!query) {
      return NextResponse.json({ error: 'No search query provided' }, { status: 400 })
    }

    const queryLower = query.toLowerCase()
    const workspacePath = resolveWorkspacePath()
    const results: SearchResult[] = []

    // Get all workspace entries
    const entries = await fs.readdir(workspacePath, { withFileTypes: true })
    const workspaceEntries: Array<{name: string, workspaceJsonPath: string, folder: string}> = []
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const workspaceJsonPath = path.join(workspacePath, entry.name, 'workspace.json')
        if (existsSync(workspaceJsonPath)) {
          try {
            const workspaceData = JSON.parse(readFileSync(workspaceJsonPath, 'utf-8'))
            workspaceEntries.push({ 
              name: entry.name, 
              workspaceJsonPath,
              folder: workspaceData.folder || ''
            })
          } catch (error) {
            workspaceEntries.push({ name: entry.name, workspaceJsonPath, folder: '' })
          }
        }
      }
    }

    // Create project name to workspace ID mapping
    const projectNameToWorkspaceId: Record<string, string> = {}
    for (const entry of workspaceEntries) {
      if (entry.folder) {
        const folderName = entry.folder.split('/').pop() || entry.folder.split('\\').pop()
        if (folderName) {
          projectNameToWorkspaceId[folderName] = entry.name
        }
      }
    }

    // Search in global storage (new format)
    const globalDbPath = path.join(workspacePath, '..', 'globalStorage', 'state.vscdb')
    
    if (existsSync(globalDbPath)) {
      try {
        globalDb = new Database(globalDbPath, { readonly: true })
        
        // Get all bubbles for content searching
        const bubbleMap: Record<string, any> = {}
        const bubbleRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'").all()
        
        for (const rowUntyped of bubbleRows) {
          const row = rowUntyped as { key: string, value: string }
          const parts = row.key.split(':')
          if (parts.length >= 3) {
            const bubbleId = parts[2]
            try {
              const bubble = JSON.parse(row.value)
              if (bubble && typeof bubble === 'object') {
                bubbleMap[bubbleId] = bubble
              }
            } catch (parseError) {
              // ignore parse errors
            }
          }
        }

        // Get project layouts for mapping conversations to workspaces
        const projectLayoutsMap: Record<string, string[]> = {}
        const messageContextRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'messageRequestContext:%'").all()
        
        for (const rowUntyped of messageContextRows) {
          const row = rowUntyped as { key: string, value: string }
          const parts = row.key.split(':')
          if (parts.length >= 2) {
            const composerId = parts[1]
            try {
              const context = JSON.parse(row.value)
              if (context.projectLayouts && Array.isArray(context.projectLayouts)) {
                if (!projectLayoutsMap[composerId]) {
                  projectLayoutsMap[composerId] = []
                }
                for (const layout of context.projectLayouts) {
                  if (typeof layout === 'string') {
                    try {
                      const layoutObj = JSON.parse(layout)
                      if (layoutObj.rootPath) {
                        projectLayoutsMap[composerId].push(layoutObj.rootPath)
                      }
                    } catch (parseError) {
                      // Skip invalid JSON
                    }
                  }
                }
              }
            } catch (parseError) {
              // ignore
            }
          }
        }

        // Search composer/agent data (new format)
        if (type === 'all' || type === 'composer') {
          const composerRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND LENGTH(value) > 10").all()
          
          for (const rowUntyped of composerRows) {
            const row = rowUntyped as { key: string, value: string }
            const composerId = row.key.split(':')[1]
            
            try {
              const composerData = JSON.parse(row.value)
              
              // Determine which project this belongs to
              const projectId = determineProjectForConversation(
                composerData,
                composerId,
                projectLayoutsMap,
                projectNameToWorkspaceId,
                workspaceEntries,
                bubbleMap
              )
              
              // Get workspace folder info
              const workspaceEntry = workspaceEntries.find(e => e.name === projectId)
              const workspaceFolder = workspaceEntry?.folder
              
              // Get conversation title
              let title = composerData.name || `Conversation ${composerId.slice(0, 8)}`
              
              // Search in title
              let hasMatch = false
              let matchingText = ''
              
              if (title.toLowerCase().includes(queryLower)) {
                hasMatch = true
                matchingText = title
              }
              
              // Search in conversation bubbles
              if (!hasMatch) {
                const conversationHeaders = composerData.fullConversationHeadersOnly || []
                for (const header of conversationHeaders) {
                  const bubble = bubbleMap[header.bubbleId]
                  if (bubble) {
                    const text = extractTextFromBubble(bubble)
                    if (text.toLowerCase().includes(queryLower)) {
                      hasMatch = true
                      // Get a snippet around the match
                      const matchIndex = text.toLowerCase().indexOf(queryLower)
                      const start = Math.max(0, matchIndex - 50)
                      const end = Math.min(text.length, matchIndex + query.length + 100)
                      matchingText = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '')
                      break
                    }
                  }
                }
              }
              
              if (hasMatch && projectId) {
                results.push({
                  workspaceId: projectId,
                  workspaceFolder,
                  chatId: composerId,
                  chatTitle: title,
                  timestamp: composerData.lastUpdatedAt || composerData.createdAt || new Date().toISOString(),
                  matchingText,
                  type: 'composer'
                })
              }
            } catch (parseError) {
              console.error(`Error parsing composer data for ${composerId}:`, parseError)
            }
          }
        }

        // Also search in the old format chat data (for backwards compatibility)
        if (type === 'all' || type === 'chat') {
          const globalChatResult = globalDb.prepare(`
            SELECT value FROM ItemTable 
            WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'
          `).get()

          if (globalChatResult && (globalChatResult as any).value) {
            try {
              const chatData = JSON.parse((globalChatResult as any).value)
              if (chatData.tabs && Array.isArray(chatData.tabs)) {
                for (const tab of chatData.tabs) {
                  let hasMatch = false
                  let matchingText = ''

                  if (tab.chatTitle?.toLowerCase().includes(queryLower)) {
                    hasMatch = true
                    matchingText = tab.chatTitle
                  }

                  if (!hasMatch && tab.bubbles && Array.isArray(tab.bubbles)) {
                    for (const bubble of tab.bubbles) {
                      if (bubble.text?.toLowerCase().includes(queryLower)) {
                        hasMatch = true
                        const text = bubble.text
                        const matchIndex = text.toLowerCase().indexOf(queryLower)
                        const start = Math.max(0, matchIndex - 50)
                        const end = Math.min(text.length, matchIndex + query.length + 100)
                        matchingText = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '')
                        break
                      }
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
            } catch (parseError) {
              console.error('Error parsing global chat data:', parseError)
            }
          }
        }

        globalDb.close()
        globalDb = null
      } catch (error) {
        console.error('Error searching global storage:', error)
        if (globalDb) {
          globalDb.close()
          globalDb = null
        }
      }
    }

    // Also search in workspace-specific state.vscdb files (old format)
    for (const entry of workspaceEntries) {
      const dbPath = path.join(workspacePath, entry.name, 'state.vscdb')
      
      if (!existsSync(dbPath)) continue

      try {
        const db = new Database(dbPath, { readonly: true })

        // Search chat logs (old format)
        if (type === 'all' || type === 'chat') {
          const chatResult = db.prepare(`
            SELECT value FROM ItemTable 
            WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'
          `).get()

          if (chatResult && (chatResult as any).value) {
            try {
              const chatData = JSON.parse((chatResult as any).value)
              if (chatData.tabs && Array.isArray(chatData.tabs)) {
                for (const tab of chatData.tabs) {
                  let hasMatch = false
                  let matchingText = ''

                  if (tab.chatTitle?.toLowerCase().includes(queryLower)) {
                    hasMatch = true
                    matchingText = tab.chatTitle
                  }

                  if (!hasMatch && tab.bubbles && Array.isArray(tab.bubbles)) {
                    for (const bubble of tab.bubbles) {
                      if (bubble.text?.toLowerCase().includes(queryLower)) {
                        hasMatch = true
                        const text = bubble.text
                        const matchIndex = text.toLowerCase().indexOf(queryLower)
                        const start = Math.max(0, matchIndex - 50)
                        const end = Math.min(text.length, matchIndex + query.length + 100)
                        matchingText = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '')
                        break
                      }
                    }
                  }

                  if (hasMatch) {
                    results.push({
                      workspaceId: entry.name,
                      workspaceFolder: entry.folder,
                      chatId: tab.tabId,
                      chatTitle: tab.chatTitle || `Chat ${tab.tabId?.substring(0, 8) || 'Untitled'}`,
                      timestamp: tab.lastSendTime || new Date().toISOString(),
                      matchingText,
                      type: 'chat'
                    })
                  }
                }
              }
            } catch (parseError) {
              // ignore
            }
          }
        }

        // Search composer logs (old format)
        if (type === 'all' || type === 'composer') {
          const composerResult = db.prepare(`
            SELECT value FROM ItemTable 
            WHERE [key] = 'composer.composerData'
          `).get()

          if (composerResult && (composerResult as any).value) {
            try {
              const composerData = JSON.parse((composerResult as any).value)
              if (composerData.allComposers && Array.isArray(composerData.allComposers)) {
                for (const composer of composerData.allComposers) {
                  let hasMatch = false
                  let matchingText = ''

                  if (composer.text?.toLowerCase().includes(queryLower)) {
                    hasMatch = true
                    matchingText = composer.text
                  }

                  if (!hasMatch && Array.isArray(composer.conversation)) {
                    for (const message of composer.conversation) {
                      if (message.text?.toLowerCase().includes(queryLower)) {
                        hasMatch = true
                        const text = message.text
                        const matchIndex = text.toLowerCase().indexOf(queryLower)
                        const start = Math.max(0, matchIndex - 50)
                        const end = Math.min(text.length, matchIndex + query.length + 100)
                        matchingText = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '')
                        break
                      }
                    }
                  }

                  if (hasMatch) {
                    results.push({
                      workspaceId: entry.name,
                      workspaceFolder: entry.folder,
                      chatId: composer.composerId,
                      chatTitle: composer.text || `Composer ${composer.composerId.substring(0, 8)}`,
                      timestamp: composer.lastUpdatedAt || composer.createdAt || new Date().toISOString(),
                      matchingText,
                      type: 'composer'
                    })
                  }
                }
              }
            } catch (parseError) {
              // ignore
            }
          }
        }

        db.close()
      } catch (error) {
        console.error(`Error processing workspace ${entry.name}:`, error)
      }
    }

    // Remove duplicates based on chatId
    const uniqueResults = results.filter((result, index, self) =>
      index === self.findIndex((r) => r.chatId === result.chatId)
    )

    // Sort results by timestamp, newest first
    uniqueResults.sort((a, b) => {
      const timeA = typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime()
      const timeB = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime()
      return timeB - timeA
    })

    return NextResponse.json({ results: uniqueResults })
  } catch (error) {
    console.error('Search failed:', error)
    if (globalDb) {
      globalDb.close()
    }
    return NextResponse.json({ error: 'Search failed', results: [] }, { status: 500 })
  }
}
