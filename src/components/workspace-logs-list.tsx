"use client"

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Loading } from "@/components/ui/loading"
import { Badge } from "@/components/ui/badge"

interface WorkspaceLog {
  id: string;
  workspaceId: string;
  workspaceFolder?: string;
  title: string;
  timestamp: number;
  type: 'chat' | 'composer';
  messageCount: number;
}

export function WorkspaceLogsList() {
  const [logs, setLogs] = useState<WorkspaceLog[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const response = await fetch('/api/logs')
        const data = await response.json()
        setLogs(data.logs || [])
      } catch (error) {
        console.error('Failed to fetch logs:', error)
        setLogs([])
      } finally {
        setIsLoading(false)
      }
    }
    fetchLogs()
  }, [])

  if (isLoading) {
    return <Loading message="Loading logs..." />
  }

  // Separate global logs and workspace logs
  const globalLogs = logs.filter(log => log.workspaceId === 'global')
  const workspaceLogs = logs.filter(log => log.workspaceId !== 'global')

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Workspace</TableHead>
          <TableHead>Last Modified</TableHead>
          <TableHead className="text-right">Messages</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {/* Global Storage logs */}
        {globalLogs.length > 0 && (
          <>
            <TableRow>
              <TableCell colSpan={5} className="bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200 font-semibold text-center">
                🌐 Global Storage (Newer Cursor chats)
              </TableCell>
            </TableRow>
            {globalLogs.map((log) => (
              <TableRow key={`global-${log.id}`} className="hover:bg-accent/50">
                <TableCell>
                  <Link 
                    href={`/workspace/global?tab=${log.id}&type=chat`}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    {log.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="default">Ask Log</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-start space-x-2">
                    <span className="text-blue-500 mt-1">🌐</span>
                    <span className="break-all text-sm text-blue-600">
                      Global Storage
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  {format(new Date(log.timestamp), 'PPp')}
                </TableCell>
                <TableCell className="text-right">
                  {log.messageCount}
                </TableCell>
              </TableRow>
            ))}
            {/* Visual separator */}
            {workspaceLogs.length > 0 && (
              <TableRow>
                <TableCell colSpan={5} className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-center">
                  Workspace Storage (Older Cursor chats)
                </TableCell>
              </TableRow>
            )}
          </>
        )}
        {/* Workspace logs */}
        {workspaceLogs.map((log) => (
          <TableRow key={`${log.type}-${log.id}`} className="hover:bg-accent/50">
            <TableCell>
              <Link 
                href={`/workspace/${log.workspaceId}?tab=${log.id}&type=${log.type}`}
                className="text-blue-600 hover:underline font-medium"
              >
                {log.title}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant={log.type === 'chat' ? 'default' : 'secondary'}>
                {log.type === 'chat' ? 'Ask Log' : 'Agent Log'}
              </Badge>
            </TableCell>
            <TableCell>
              {log.workspaceFolder ? (
                <div className="flex items-start space-x-2">
                  <span className="text-gray-500 mt-1">📁</span>
                  <span 
                    className="break-all text-sm"
                    title={log.workspaceFolder}
                  >
                    {log.workspaceFolder}
                  </span>
                </div>
              ) : (
                <span className="text-gray-400 italic">No folder</span>
              )}
            </TableCell>
            <TableCell>
              {format(new Date(log.timestamp), 'PPp')}
            </TableCell>
            <TableCell className="text-right">
              {/* Fix composer message count */}
              {log.type === 'composer' && (log as any).messageCount === 0 && (log as any).conversation ? (log as any).conversation.length : log.messageCount}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
} 