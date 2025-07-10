import { NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import Database from 'better-sqlite3'
import { resolveWorkspacePath } from '@/utils/workspace-path'
import { ComposerData } from '@/types/workspace'

interface ChatBubble {
  type: 'user' | 'ai'
  text: string
  timestamp: number
}

interface ChatTab {
  id: string
  title: string
  timestamp: number
  bubbles: ChatBubble[]
  codeBlockDiffs: any[]
}

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

function extractChatIdFromBubbleKey(key: string): string | null {
  // key format: bubbleId:<chatId>:<bubbleId>
  const match = key.match(/^bubbleId:([^:]+):/)
  return match ? match[1] : null
}

function extractChatIdFromCodeBlockDiffKey(key: string): string | null {
  // key format: codeBlockDiff:<chatId>:<diffId>
  const match = key.match(/^codeBlockDiff:([^:]+):/)
  return match ? match[1] : null
}

function formatToolAction(action: any): string {
  if (!action) return ''
  
  let result = ''
  
  // Handle code changes
  if (action.newModelDiffWrtV0 && action.newModelDiffWrtV0.length > 0) {
    for (const diff of action.newModelDiffWrtV0) {
      if (diff.modified && diff.modified.length > 0) {
        result += `\n\n**Code Changes:**\n\`\`\`\n${diff.modified.join('\n')}\n\`\`\``
      }
    }
  }
  
  // Handle file operations
  if (action.filePath) {
    result += `\n\n**File:** ${action.filePath}`
  }
  
  // Handle terminal commands
  if (action.command) {
    result += `\n\n**Command:** \`${action.command}\``
  }
  
  // Handle search results
  if (action.searchResults) {
    result += `\n\n**Search Results:**\n${action.searchResults}`
  }
  
  // Handle web search results
  if (action.webResults) {
    result += `\n\n**Web Search:**\n${action.webResults}`
  }
  
  // Handle tool actions with specific types
  if (action.toolName) {
    result += `\n\n**Tool Action:** ${action.toolName}`
    
    if (action.parameters) {
      try {
        const params = typeof action.parameters === 'string' ? JSON.parse(action.parameters) : action.parameters
        if (params.command) {
          result += `\n**Command:** \`${params.command}\``
        }
        if (params.target_file) {
          result += `\n**File:** ${params.target_file}`
        }
        if (params.query) {
          result += `\n**Query:** ${params.query}`
        }
        if (params.instructions) {
          result += `\n**Instructions:** ${params.instructions}`
        }
      } catch (error) {
        console.error('Error parsing tool parameters:', error)
      }
    }
    
    if (action.result) {
      try {
        const resultData = typeof action.result === 'string' ? JSON.parse(action.result) : action.result
        if (resultData.output) {
          result += `\n\n**Output:**\n\`\`\`\n${resultData.output}\n\`\`\``
        }
        if (resultData.contents) {
          result += `\n\n**File Contents:**\n\`\`\`\n${resultData.contents}\n\`\`\``
        }
        if (resultData.exitCodeV2 !== undefined) {
          result += `\n\n**Exit Code:** ${resultData.exitCodeV2}`
        }
        if (resultData.files && resultData.files.length > 0) {
          result += `\n\n**Files Found:**`
          for (const file of resultData.files) {
            result += `\n- ${file.name || file.path} (${file.type || 'file'})`
          }
        }
        if (resultData.results && resultData.results.length > 0) {
          result += `\n\n**Results:**`
          for (const searchResult of resultData.results) {
            if (searchResult.file && searchResult.content) {
              result += `\n\n**File:** ${searchResult.file}`
              result += `\n\`\`\`\n${searchResult.content}\n\`\`\``
            }
          }
        }
      } catch (error) {
        console.error('Error parsing tool result:', error)
      }
    }
  }
  
  // Handle actions taken
  if (action.actionsTaken && action.actionsTaken.length > 0) {
    result += `\n\n**Actions Taken:** ${action.actionsTaken.join(', ')}`
  }
  
  // Handle files modified
  if (action.filesModified && action.filesModified.length > 0) {
    result += `\n\n**Files Modified:**`
    for (const file of action.filesModified) {
      result += `\n- ${file}`
    }
  }
  
  // Handle git status
  if (action.gitStatus) {
    result += `\n\n**Git Status:**\n\`\`\`\n${action.gitStatus}\n\`\`\``
  }
  
  // Handle directory listings
  if (action.directoryListed) {
    result += `\n\n**Directory Listed:** ${action.directoryListed}`
  }
  
  // Handle web search results
  if (action.webSearchResults) {
    result += `\n\n**Web Search Results:**`
    for (const searchResult of action.webSearchResults) {
      if (searchResult.title) {
        result += `\n- ${searchResult.title}`
      }
    }
  }
  
  return result
}

function extractTextFromBubble(bubble: any): string {
  let text = ''
  
  // Try to get text from the text field first
  if (bubble.text && bubble.text.trim()) {
    text = bubble.text
  }
  
  // If no text, try to extract from richText
  if (!text && bubble.richText) {
    try {
      const richTextData = JSON.parse(bubble.richText)
      if (richTextData.root && richTextData.root.children) {
        text = extractTextFromRichText(richTextData.root.children)
      }
    } catch (error) {
      console.error('Error parsing richText:', error)
    }
  }
  
  // If it's an AI message with code blocks, include them
  if (bubble.codeBlocks && Array.isArray(bubble.codeBlocks)) {
    for (const codeBlock of bubble.codeBlocks) {
      if (codeBlock.content) {
        text += `\n\n\`\`\`${codeBlock.language || ''}\n${codeBlock.content}\n\`\`\``
      }
    }
  }
  
  return text
}

function extractTextFromRichText(children: any[]): string {
  let text = ''
  
  for (const child of children) {
    if (child.type === 'text' && child.text) {
      text += child.text
    } else if (child.type === 'code' && child.children) {
      text += '\n```\n'
      text += extractTextFromRichText(child.children)
      text += '\n```\n'
    } else if (child.children && Array.isArray(child.children)) {
      text += extractTextFromRichText(child.children)
    }
  }
  
  return text
}

// Unified function to determine which project a conversation belongs to (same as in workspaces route)
function determineProjectForConversation(
  composerData: any, 
  composerId: string,
  projectLayoutsMap: Record<string, string[]>,
  projectNameToWorkspaceId: Record<string, string>,
  workspaceEntries: Array<{name: string, workspaceJsonPath: string}>,
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
  
  // If no project found from projectLayouts, try file-based detection (fallback)
  // Check newlyCreatedFiles first
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
      const normalizedPath = filePath.replace('file://', '')
      const projectId = getProjectFromFilePath(normalizedPath, workspaceEntries)
      if (projectId) return projectId
    }
  }
  
  // Check if this conversation has any file references in bubbles
  const conversationHeaders = composerData.fullConversationHeadersOnly || []
  for (const header of conversationHeaders) {
    const bubbleId = header.bubbleId
    const bubble = bubbleMap[bubbleId]
    
    if (bubble) {
      // Check relevantFiles
      if (bubble.relevantFiles && Array.isArray(bubble.relevantFiles) && bubble.relevantFiles.length > 0) {
        for (const filePath of bubble.relevantFiles) {
          if (filePath) {
            const projectId = getProjectFromFilePath(filePath, workspaceEntries)
            if (projectId) return projectId
          }
        }
      }
      
      // Check attachedFileCodeChunksUris
      if (bubble.attachedFileCodeChunksUris && Array.isArray(bubble.attachedFileCodeChunksUris) && bubble.attachedFileCodeChunksUris.length > 0) {
        for (const uri of bubble.attachedFileCodeChunksUris) {
          if (uri && uri.path) {
            const projectId = getProjectFromFilePath(uri.path, workspaceEntries)
            if (projectId) return projectId
          }
        }
      }
      
      // Check context.fileSelections
      if (bubble.context && bubble.context.fileSelections && Array.isArray(bubble.context.fileSelections) && bubble.context.fileSelections.length > 0) {
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

function getProjectFromFilePath(filePath: string, workspaceEntries: Array<{name: string, workspaceJsonPath: string}>): string | null {
  // Normalize the file path
  const normalizedPath = filePath.replace(/^\/Users\/evaran\//, '')
  
  for (const entry of workspaceEntries) {
    try {
      const workspaceData = JSON.parse(readFileSync(entry.workspaceJsonPath, 'utf-8'))
      if (workspaceData.folder) {
        const workspacePath = workspaceData.folder.replace('file://', '').replace(/^\/Users\/evaran\//, '')
        if (normalizedPath.startsWith(workspacePath)) {
          return entry.name
        }
      }
    } catch (error) {
      console.error(`Error reading workspace ${entry.name}:`, error)
    }
  }
  return null
}

function createProjectNameToWorkspaceIdMap(workspaceEntries: Array<{name: string, workspaceJsonPath: string}>): Record<string, string> {
  const projectNameToWorkspaceId: Record<string, string> = {}
  
  for (const entry of workspaceEntries) {
    try {
      const workspaceData = JSON.parse(readFileSync(entry.workspaceJsonPath, 'utf-8'))
      if (workspaceData.folder) {
        const workspacePath = workspaceData.folder.replace('file://', '')
        const folderName = workspacePath.split('/').pop() || workspacePath.split('\\').pop()
        if (folderName) {
          projectNameToWorkspaceId[folderName] = entry.name
        }
      }
    } catch (error) {
      console.error(`Error reading workspace ${entry.name}:`, error)
    }
  }
  
  return projectNameToWorkspaceId
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  let globalDb: any = null
  
  try {
    const workspacePath = resolveWorkspacePath()
    const globalDbPath = path.join(workspacePath, '..', 'globalStorage', 'state.vscdb')

    const response: { tabs: ChatTab[], composers?: ComposerData } = { tabs: [] }

    // Get all workspace entries for project mapping
    const entries = await fs.readdir(workspacePath, { withFileTypes: true })
    const workspaceEntries: Array<{name: string, workspaceJsonPath: string}> = []
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const workspaceJsonPath = path.join(workspacePath, entry.name, 'workspace.json')
        if (existsSync(workspaceJsonPath)) {
          workspaceEntries.push({ name: entry.name, workspaceJsonPath })
        }
      }
    }
    
    // Create project name to workspace ID mapping
    const projectNameToWorkspaceId = createProjectNameToWorkspaceIdMap(workspaceEntries)

    let bubbleMap: Record<string, any> = {}
    let codeBlockDiffMap: Record<string, any[]> = {}
    let messageRequestContextMap: Record<string, any[]> = {}
    
    if (existsSync(globalDbPath)) {
      globalDb = new Database(globalDbPath, { readonly: true })
      
      // Get all bubbleId entries for the actual message content
      const bubbleRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'").all()
      for (const rowUntyped of bubbleRows) {
        const row = rowUntyped as { key: string, value: string }
        const bubbleId = row.key.split(':')[2]
        try {
          const bubble = JSON.parse(row.value)
          if (bubble && typeof bubble === 'object') {
            bubbleMap[bubbleId] = bubble
          }
        } catch (parseError) {
          console.error('Error parsing bubble:', parseError)
        }
      }
      
      // codeBlockDiff
      const codeBlockDiffRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'codeBlockDiff:%'").all()
      for (const rowUntyped of codeBlockDiffRows) {
        const row = rowUntyped as { key: string, value: string }
        const chatId = extractChatIdFromCodeBlockDiffKey(row.key)
        if (!chatId) continue
        try {
          const codeBlockDiff = JSON.parse(row.value)
          if (!codeBlockDiffMap[chatId]) codeBlockDiffMap[chatId] = []
          codeBlockDiffMap[chatId].push({
            ...codeBlockDiff,
            diffId: row.key.split(':')[2]
          })
        } catch (parseError) {
          console.error('Error parsing codeBlockDiff:', parseError)
        }
      }
      
      // messageRequestContext
      const messageRequestContextRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'messageRequestContext:%'").all()
      for (const rowUntyped of messageRequestContextRows) {
        const row = rowUntyped as { key: string, value: string }
        const parts = row.key.split(':')
        if (parts.length >= 3) {
          const chatId = parts[1]
          const contextId = parts[2]
          try {
            const context = JSON.parse(row.value)
            if (!messageRequestContextMap[chatId]) messageRequestContextMap[chatId] = []
            messageRequestContextMap[chatId].push({
              ...context,
              contextId: contextId
            })
          } catch (parseError) {
            console.error('Error parsing messageRequestContext:', parseError)
          }
        }
      }
      
      // Create a map of composerId -> projectLayouts for efficient lookup
      const projectLayoutsMap: Record<string, string[]> = {}
      for (const rowUntyped of messageRequestContextRows) {
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
            console.error('Error parsing messageRequestContext:', parseError)
          }
        }
      }

      // Get all composerData entries that have conversation data
      const composerRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND value LIKE '%fullConversationHeadersOnly%' AND value NOT LIKE '%fullConversationHeadersOnly\":[]%'").all()
      
      // Process each composerData entry and check if it belongs to this workspace
      for (const rowUntyped of composerRows) {
        const row = rowUntyped as { key: string, value: string }
        const composerId = row.key.split(':')[1]
        
        try {
          const composerData = JSON.parse(row.value)
          
          // Determine which project this conversation belongs to using unified logic
          const projectId = determineProjectForConversation(
            composerData,
            composerId,
            projectLayoutsMap,
            projectNameToWorkspaceId,
            workspaceEntries,
            bubbleMap
          )
          
          // Only process conversations that belong to this specific workspace
          if (projectId !== params.id) {
            continue
          }
          
          console.log(`Processing workspace conversation ${composerId}: ${composerData.name || 'Untitled'}`)
          
          // Get the conversation headers to understand the structure
          const conversationHeaders = composerData.fullConversationHeadersOnly || []
          
          // Build the conversation from the headers and bubble content
          const bubbles: ChatBubble[] = []
          for (const header of conversationHeaders) {
            const bubbleId = header.bubbleId
            const bubble = bubbleMap ? bubbleMap[bubbleId] : null
            
            if (bubble) {
              // Determine if this is a user or AI message
              const isUser = header.type === 1
              const messageType = isUser ? 'user' : 'ai'
              
              // Extract the actual text content
              const text = extractTextFromBubble(bubble)
              
              // Add messageRequestContext data if available
              let contextText = ''
              const messageContexts = messageRequestContextMap[composerId] || []
              for (const context of messageContexts) {
                if (context.bubbleId === bubbleId) {
                  // Add git status if available
                  if (context.gitStatusRaw) {
                    contextText += `\n\n**Git Status:**\n\`\`\`\n${context.gitStatusRaw}\n\`\`\``
                  }
                  
                  // Add terminal files if available
                  if (context.terminalFiles && context.terminalFiles.length > 0) {
                    contextText += `\n\n**Terminal Files:**`
                    for (const file of context.terminalFiles) {
                      contextText += `\n- ${file.path}`
                    }
                  }
                  
                  // Add attached folders if available
                  if (context.attachedFoldersListDirResults && context.attachedFoldersListDirResults.length > 0) {
                    contextText += `\n\n**Attached Folders:**`
                    for (const folder of context.attachedFoldersListDirResults) {
                      if (folder.files && folder.files.length > 0) {
                        contextText += `\n\n**Folder:** ${folder.path || 'Unknown'}`
                        for (const file of folder.files) {
                          contextText += `\n- ${file.name} (${file.type})`
                        }
                      }
                    }
                  }
                  
                  // Add cursor rules if available
                  if (context.cursorRules && context.cursorRules.length > 0) {
                    contextText += `\n\n**Cursor Rules:**`
                    for (const rule of context.cursorRules) {
                      contextText += `\n- ${rule.name || rule.description || 'Rule'}`
                    }
                  }
                  
                  // Add summarized composers if available
                  if (context.summarizedComposers && context.summarizedComposers.length > 0) {
                    contextText += `\n\n**Related Conversations:**`
                    for (const composer of context.summarizedComposers) {
                      contextText += `\n- ${composer.name || composer.composerId || 'Conversation'}`
                    }
                  }
                }
              }
              
              // Combine text and context
              const fullText = text + contextText
              
              if (fullText.trim()) {
                bubbles.push({
                  type: messageType,
                  text: fullText,
                  timestamp: bubble.timestamp || Date.now()
                })
              }
            }
          }
          
          if (bubbles.length > 0) {
            // Generate a title from the composer name or first message
            let title = composerData.name || `Conversation ${composerId.slice(0, 8)}`
            if (!composerData.name && bubbles.length > 0) {
              const firstMessage = bubbles[0].text
              if (firstMessage) {
                const firstLines = firstMessage.split('\n').filter((line: string) => line.trim().length > 0)
                if (firstLines.length > 0) {
                  title = firstLines[0].substring(0, 100)
                  if (title.length === 100) title += '...'
                }
              }
            }
            
            // Get codeBlockDiffs for this conversation and add them as separate bubbles
            const codeBlockDiffs = codeBlockDiffMap[composerId] || []
            for (const diff of codeBlockDiffs) {
              const diffText = formatToolAction(diff)
              if (diffText.trim()) {
                bubbles.push({
                  type: 'ai',
                  text: `**Tool Action:**${diffText}`,
                  timestamp: Date.now()
                })
              }
            }
            
            // Sort bubbles by timestamp to ensure proper order
            bubbles.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
            
            response.tabs.push({
              id: composerId,
              title,
              timestamp: new Date(composerData.lastUpdatedAt || composerData.createdAt).getTime(),
              bubbles: bubbles.map(bubble => ({
                type: bubble.type,
                text: bubble.text || '',
                timestamp: bubble.timestamp || Date.now()
              })),
              codeBlockDiffs: codeBlockDiffs
            })
          }
          
        } catch (parseError) {
          console.error(`Error parsing composer data for ${composerId}:`, parseError)
        }
      }
      
      console.log(`Returning ${response.tabs.length} conversations for workspace ${params.id}`)
    } else {
      return NextResponse.json({ error: 'Global storage not found' }, { status: 404 })
    }

    if (globalDb) {
      globalDb.close()
    }
    
    return NextResponse.json(response)
  } catch (error) {
    console.error('Failed to get workspace tabs:', error)
    if (globalDb) {
      globalDb.close()
    }
    return NextResponse.json({ error: 'Failed to get workspace tabs' }, { status: 500 })
  }
}
