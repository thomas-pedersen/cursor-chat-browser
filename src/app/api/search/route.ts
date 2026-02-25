import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import Database from 'better-sqlite3'
import { resolveWorkspacePath } from '@/utils/workspace-path'

type DbItemRow = { value?: string } | undefined

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')
    const type = searchParams.get('type') || 'all'
    const workspace = searchParams.get('workspace') || 'all'
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const match = searchParams.get('match') || 'contains'
    const sort = searchParams.get('sort') === 'asc' ? 'asc' : 'desc'
    const debug = searchParams.get('debug') === '1'

    if (!query) {
      return NextResponse.json({ error: 'No search query provided' }, { status: 400 })
    }

    const workspacePath = resolveWorkspacePath()
    const results: Array<{
      workspaceId: string
      workspaceFolder: string | undefined
      chatId: string
      chatTitle: string
      timestamp: string | number
      matchingText: string
      type: 'chat' | 'composer'
    }> = []
    const workspaceOptions: Array<{ id: string; label: string }> = [{ id: 'all', label: 'All workspaces' }]
    const debugInfo: Record<string, unknown> = {}
    const lowerQuery = query.toLowerCase()

    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : undefined
    const toTime = to ? new Date(`${to}T23:59:59.999`).getTime() : undefined

    const matchesQuery = (text: string | undefined) => {
      if (!text) return false
      const lowerText = text.toLowerCase()
      return match === 'exact' ? lowerText === lowerQuery : lowerText.includes(lowerQuery)
    }

    const matchesDateRange = (timestamp: string | number | undefined) => {
      if (!timestamp) return false
      const value = new Date(timestamp).getTime()
      if (Number.isNaN(value)) return false
      if (fromTime !== undefined && value < fromTime) return false
      if (toTime !== undefined && value > toTime) return false
      return true
    }

    const buildMatchSnippet = (text: string, maxLength = 220) => {
      const normalized = text.replace(/\s+/g, ' ').trim()
      const lower = normalized.toLowerCase()
      const idx = lower.indexOf(lowerQuery)
      if (idx === -1) return normalized.slice(0, maxLength)
      const start = Math.max(0, idx - 80)
      const end = Math.min(normalized.length, idx + Math.max(maxLength - 80, 120))
      return normalized.slice(start, end)
    }

    const normalizeDbValue = (value: unknown) => {
      if (typeof value === 'string') return value
      if (Buffer.isBuffer(value)) return value.toString('utf8')
      if (value === null || value === undefined) return ''
      return String(value)
    }

    const workspaceFoldersById: Record<string, string> = {}
    const projectNameToWorkspaceId: Record<string, string> = {}
    const entries = await fs.readdir(workspacePath, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const workspaceJsonPath = path.join(workspacePath, entry.name, 'workspace.json')
      if (!existsSync(workspaceJsonPath)) continue

      try {
        const workspaceData = JSON.parse(await fs.readFile(workspaceJsonPath, 'utf-8')) as { folder?: string }
        if (!workspaceData.folder) continue
        workspaceFoldersById[entry.name] = workspaceData.folder
        const folderName = workspaceData.folder.replace('file://', '').split('/').pop()
        if (folderName) {
          projectNameToWorkspaceId[folderName] = entry.name
        }
      } catch {
        // Ignore unreadable workspace metadata
      }
    }

    // Search global storage for chat data first
    const globalDbPath = path.join(workspacePath, '..', 'globalStorage', 'state.vscdb')
    if (debug) {
      debugInfo.workspacePath = workspacePath
      debugInfo.globalDbPath = globalDbPath
      debugInfo.globalDbExists = existsSync(globalDbPath)
    }
    if (existsSync(globalDbPath)) {
      workspaceOptions.push({ id: 'global', label: 'Global Storage' })
    }
    if (existsSync(globalDbPath) && (type === 'all' || type === 'chat') && (workspace === 'all' || workspace === 'global')) {
      try {
        const globalDb = new Database(globalDbPath, { readonly: true })
        const globalChatResult = globalDb.prepare(`
          SELECT value FROM ItemTable 
          WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'
        `).get() as DbItemRow

        if (globalChatResult?.value) {
          const chatData = JSON.parse(globalChatResult.value)
          for (const tab of chatData.tabs) {
            let hasMatch = false
            let matchingText = ''

            // Search in chat title
            if (matchesQuery(tab.chatTitle)) {
              hasMatch = true
              matchingText = tab.chatTitle
            }

            // Search in bubbles
            for (const bubble of tab.bubbles) {
              if (matchesQuery(bubble.text)) {
                hasMatch = true
                matchingText = bubble.text
                break
              }
            }

            const tabTimestamp = tab.lastSendTime || new Date().toISOString()
            if (hasMatch && matchesDateRange(tabTimestamp)) {
              results.push({
                workspaceId: 'global',
                workspaceFolder: undefined,
                chatId: tab.tabId,
                chatTitle: tab.chatTitle || `Chat ${tab.tabId?.substring(0, 8) || 'Untitled'}`,
                timestamp: tabTimestamp,
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

    // Search modern composer data in global cursorDiskKV storage.
    if (existsSync(globalDbPath) && (type === 'all' || type === 'composer')) {
      try {
        const globalDb = new Database(globalDbPath, { readonly: true })
        const projectLayoutsMap: Record<string, string[]> = {}
        const bubbleMatchByComposer: Record<string, string> = {}

        const contextRows = globalDb
          .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'messageRequestContext:%'")
          .all() as Array<{ key: string; value: unknown }>

        for (const row of contextRows) {
          const parts = row.key.split(':')
          if (parts.length < 2) continue
          const composerId = parts[1]
          const contextRaw = normalizeDbValue(row.value)
          if (!contextRaw) continue
          try {
            const context = JSON.parse(contextRaw) as { projectLayouts?: string[] }
            if (!Array.isArray(context.projectLayouts)) continue
            if (!projectLayoutsMap[composerId]) projectLayoutsMap[composerId] = []
            for (const layout of context.projectLayouts) {
              try {
                const parsed = JSON.parse(layout) as { rootPath?: string }
                if (parsed.rootPath) projectLayoutsMap[composerId].push(parsed.rootPath)
              } catch {
                // Ignore malformed layout entry
              }
            }
          } catch {
            // Ignore malformed context entry
          }
        }

        const bubbleRows = globalDb
          .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'")
          .all() as Array<{ key: string; value: unknown }>

        for (const row of bubbleRows) {
          const parts = row.key.split(':')
          if (parts.length < 3) continue
          const composerId = parts[1]
          const raw = normalizeDbValue(row.value)
          if (!raw) continue
          const lowerRaw = raw.toLowerCase()
          const hasRawMatch = match === 'exact' ? lowerRaw === lowerQuery : lowerRaw.includes(lowerQuery)
          if (!hasRawMatch) continue

          if (!bubbleMatchByComposer[composerId]) {
            try {
              const bubble = JSON.parse(raw) as { text?: string; richText?: string }
              const source = bubble.text || bubble.richText || raw
              bubbleMatchByComposer[composerId] = buildMatchSnippet(source)
            } catch {
              bubbleMatchByComposer[composerId] = buildMatchSnippet(raw)
            }
          }
        }

        const composerRows = globalDb
          .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
          .all() as Array<{ key: string; value: unknown }>

        for (const row of composerRows) {
          const parts = row.key.split(':')
          if (parts.length < 2) continue
          const composerId = parts[1]
          const composerRaw = normalizeDbValue(row.value)
          if (!composerRaw) continue

          let composerData:
            | {
                name?: string
                text?: string
                lastUpdatedAt?: number
                createdAt?: number
              }
            | undefined
          try {
            composerData = JSON.parse(composerRaw)
          } catch {
            continue
          }

          const candidateWorkspaceIds = (projectLayoutsMap[composerId] || [])
            .map((rootPath) => {
              const basename = rootPath.split('/').pop()
              return basename ? projectNameToWorkspaceId[basename] : undefined
            })
            .filter((id): id is string => Boolean(id))

          const resolvedWorkspaceId = candidateWorkspaceIds[0] || 'global'
          if (workspace !== 'all' && workspace !== resolvedWorkspaceId) continue

          const title = composerData.name || composerData.text || `Composer ${composerId.substring(0, 8)}`
          const textMatch = matchesQuery(composerData.text) || matchesQuery(composerData.name)
          const bubbleMatch = bubbleMatchByComposer[composerId]
          if (!textMatch && !bubbleMatch) continue

          const timestamp = composerData.lastUpdatedAt || composerData.createdAt || Date.now()
          if (!matchesDateRange(timestamp)) continue

          results.push({
            workspaceId: resolvedWorkspaceId,
            workspaceFolder: workspaceFoldersById[resolvedWorkspaceId],
            chatId: composerId,
            chatTitle: title,
            timestamp,
            matchingText: bubbleMatch || buildMatchSnippet(composerData.text || title),
            type: 'composer'
          })
        }

        globalDb.close()
      } catch (error) {
        console.error('Error searching modern global composer storage:', error)
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (workspace !== 'all' && workspace !== entry.name) continue
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
        workspaceOptions.push({ id: entry.name, label: workspaceFolder || entry.name })

        try {
          const db = new Database(dbPath, { readonly: true })

          // Search chat logs if type is 'all' or 'chat'
          if (type === 'all' || type === 'chat') {
            const chatResult = db.prepare(`
              SELECT value FROM ItemTable 
              WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'
            `).get() as DbItemRow

            if (chatResult?.value) {
              const chatData = JSON.parse(chatResult.value)
              for (const tab of chatData.tabs) {
                let hasMatch = false
                let matchingText = ''

                // Search in chat title
                if (matchesQuery(tab.chatTitle)) {
                  hasMatch = true
                  matchingText = tab.chatTitle
                }

                // Search in bubbles
                for (const bubble of tab.bubbles) {
                  if (matchesQuery(bubble.text)) {
                    hasMatch = true
                    matchingText = bubble.text
                    break
                  }
                }

                const tabTimestamp = tab.lastSendTime || new Date().toISOString()
                if (hasMatch && matchesDateRange(tabTimestamp)) {
                  results.push({
                    workspaceId: entry.name,
                    workspaceFolder,
                    chatId: tab.tabId,
                    chatTitle: tab.chatTitle || `Chat ${tab.tabId?.substring(0, 8) || 'Untitled'}`,
                    timestamp: tabTimestamp,
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
            `).get() as DbItemRow

            if (composerResult?.value) {
              const composerData = JSON.parse(composerResult.value)
              for (const composer of composerData.allComposers) {
                let hasMatch = false
                let matchingText = ''

                // Search in composer text/title
                if (matchesQuery(composer.text)) {
                  hasMatch = true
                  matchingText = composer.text
                }

                // Search in conversation
                if (Array.isArray(composer.conversation)) {
                  for (const message of composer.conversation) {
                    if (matchesQuery(message.text)) {
                      hasMatch = true
                      matchingText = message.text
                      break
                    }
                  }
                }

                const composerTimestamp = composer.lastUpdatedAt || composer.createdAt || new Date().toISOString()
                if (hasMatch && matchesDateRange(composerTimestamp)) {
                  results.push({
                    workspaceId: entry.name,
                    workspaceFolder,
                    chatId: composer.composerId,
                    chatTitle: composer.text || `Composer ${composer.composerId.substring(0, 8)}`,
                    timestamp: composerTimestamp,
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

    // Sort results by timestamp.
    results.sort((a, b) => {
      const left = new Date(a.timestamp).getTime()
      const right = new Date(b.timestamp).getTime()
      return sort === 'asc' ? left - right : right - left
    })

    return NextResponse.json(debug ? { results, workspaceOptions, debugInfo } : { results, workspaceOptions })
  } catch (error) {
    console.error('Search failed:', error)
    return NextResponse.json({ error: 'Search failed', results: [] }, { status: 500 })
  }
} 