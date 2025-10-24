import { readFileSync, existsSync } from 'fs'
import { statSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import Database from 'better-sqlite3'
import { resolveWorkspacePath } from '@/utils/workspace-path'

interface Project {
  id: string;
  name: string;
  path?: string;
  conversationCount: number;
  lastModified: string;
}

interface ConversationData {
  composerId: string;
  name: string;
  newlyCreatedFiles: Array<{uri: {path: string}}>;
  lastUpdatedAt: number;
  createdAt: number;
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

// Unified function to determine which project a conversation belongs to
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

export async function GET() {
  try {
    const workspacePath = resolveWorkspacePath()
    const projects: Project[] = []
    
    // Get all workspace entries first
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
    
    // Initialize conversation map - only count from global storage
    const conversationMap: Record<string, ConversationData[]> = {}
    
    // Get conversations from global storage only
    const globalDbPath = path.join(workspacePath, '..', 'globalStorage', 'state.vscdb')
    
    if (existsSync(globalDbPath)) {
      try {
        const globalDb = new Database(globalDbPath, { readonly: true })
        
        // Get all composerData entries (both old and new structure)
        const composerRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND LENGTH(value) > 10").all()
        
        // Get all messageRequestContext entries for project assignment
        const messageContextRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'messageRequestContext:%'").all()
        
        // Create a map of composerId -> projectLayouts for efficient lookup
        const projectLayoutsMap: Record<string, string[]> = {}
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
              console.error('Error parsing messageRequestContext:', parseError)
            }
          }
        }
        
        // Get all bubbleId entries for file reference detection (fallback)
        const bubbleRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'").all()
        
        // Create a map of bubbleId -> bubble content for efficient lookup
        const bubbleMap: Record<string, any> = {}
        for (const rowUntyped of bubbleRows) {
          const row = rowUntyped as { key: string, value: string }
          const bubbleId = row.key.split(':')[2]
          try {
            const bubble = JSON.parse(row.value)
            // Only store valid bubble objects
            if (bubble && typeof bubble === 'object') {
              bubbleMap[bubbleId] = bubble
            }
          } catch (parseError) {
            console.error('Error parsing bubble for project detection:', parseError)
          }
        }
        
        // Process each composer and assign to correct project
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
            
            // If no project found, skip this conversation
            if (!projectId) {
              continue
            }
            
            // Add to conversation map
            if (!conversationMap[projectId]) {
              conversationMap[projectId] = []
            }
            
            conversationMap[projectId].push({
              composerId,
              name: composerData.name || `Conversation ${composerId.slice(0, 8)}`,
              newlyCreatedFiles: composerData.newlyCreatedFiles || [],
              lastUpdatedAt: composerData.lastUpdatedAt || composerData.createdAt,
              createdAt: composerData.createdAt
            })
            
          } catch (parseError) {
            console.error(`Error parsing composer data for ${composerId}:`, parseError)
          }
        }
        
        globalDb.close()
      } catch (error) {
        console.error('Error reading global storage:', error)
      }
    }
    
    // Create projects with their conversation counts
    for (const entry of workspaceEntries) {
      const dbPath = path.join(workspacePath, entry.name, 'state.vscdb')
      const stats = await fs.stat(dbPath)
      
      // Get workspace name
      let workspaceName = `Project ${entry.name.slice(0, 8)}`
      try {
        const workspaceData = JSON.parse(await fs.readFile(entry.workspaceJsonPath, 'utf-8'))
        if (workspaceData.folder) {
          const folderName = workspaceData.folder.split('/').pop() || workspaceData.folder.split('\\').pop()
          workspaceName = folderName || workspaceName
        }
      } catch (error) {
        console.log(`No workspace.json found for ${entry.name}`)
      }
      
      // Count conversations for this project from the unified map only
      const conversations = conversationMap[entry.name] || []
      const conversationCount = conversations.length
      
      // Show all projects, even those with 0 conversations
      projects.push({
        id: entry.name,
        name: workspaceName,
        path: entry.workspaceJsonPath,
        conversationCount: conversationCount,
        lastModified: stats.mtime.toISOString()
      })
    }
    
    // Sort by last modified, newest first
    projects.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
    
    return NextResponse.json(projects)
  } catch (error) {
    console.error('Failed to get workspaces:', error)
    return NextResponse.json({ error: 'Failed to get workspaces' }, { status: 500 })
  }
} 