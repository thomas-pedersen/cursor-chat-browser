import { NextResponse } from "next/server"
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import { resolveWorkspacePath } from '@/utils/workspace-path'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const workspacePath = resolveWorkspacePath()
    const dbPath = path.join(workspacePath, params.id, 'state.vscdb')
    const workspaceJsonPath = path.join(workspacePath, params.id, 'workspace.json')

    if (!existsSync(dbPath)) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const stats = await fs.stat(dbPath)
    let folder = undefined

    try {
      const workspaceData = JSON.parse(await fs.readFile(workspaceJsonPath, 'utf-8'))
      folder = workspaceData.folder
    } catch (error) {
      console.log(`No workspace.json found for ${params.id}`)
    }

    return NextResponse.json({
      id: params.id,
      path: dbPath,
      folder: folder,
      lastModified: stats.mtime.toISOString()
    })
  } catch (error) {
    console.error('Failed to get workspace:', error)
    return NextResponse.json({ error: 'Failed to get workspace' }, { status: 500 })
  }
} 