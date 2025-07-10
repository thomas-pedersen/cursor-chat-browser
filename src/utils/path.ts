import os from 'os'
import path from 'path'

export const expandTildePath = (inputPath: string): string => {
  const homePath = os.homedir()
  
  // Handle paths that start with ~/
  if (inputPath.startsWith('~/')) {
    return path.join(homePath, inputPath.slice(2))
  }
  
  // If the path already contains the home directory, return as is
  if (inputPath.startsWith(homePath)) {
    return inputPath
  }
  
  // Handle paths that should start with the home directory but don't have ~/
  if (inputPath.includes('Library/Application Support') && !inputPath.startsWith(homePath)) {
    return path.join(homePath, inputPath)
  }
  
  return inputPath
} 