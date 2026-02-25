import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { expandTildePath } from './path'

export function getDefaultWorkspacePath(): string {
  const home = os.homedir()
  const release = os.release().toLowerCase()
  const isWSL = release.includes('microsoft') || release.includes('wsl')
  const isRemote = Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY)

  if (isWSL) {
    let username = os.userInfo().username
    try {
      const output = execSync('cmd.exe /c echo %USERNAME%', { encoding: 'utf8' })
      username = output.trim()
    } catch {
      // ignore
    }
    return `/mnt/c/Users/${username}/AppData/Roaming/Cursor/User/workspaceStorage`
  }

  switch (process.platform) {
    case 'win32':
      return path.join(home, 'AppData/Roaming/Cursor/User/workspaceStorage')
    case 'darwin':
      return path.join(home, 'Library/Application Support/Cursor/User/workspaceStorage')
    case 'linux':
      // Prefer local Cursor storage when present; SSH env vars can be set even on local sessions.
      {
        const localPath = path.join(home, '.config/Cursor/User/workspaceStorage')
        const remotePath = path.join(home, '.cursor-server/data/User/workspaceStorage')
        if (existsSync(localPath)) return localPath
        if (isRemote || existsSync(remotePath)) return remotePath
        return localPath
      }
    default:
      return path.join(home, 'workspaceStorage')
  }
}

export function resolveWorkspacePath(): string {
  const envPath = process.env.WORKSPACE_PATH
  if (envPath && envPath.trim() !== '') {
    return expandTildePath(envPath)
  }
  return getDefaultWorkspacePath()
}
