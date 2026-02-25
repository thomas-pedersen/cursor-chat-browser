"use client"

import { useSearchParams } from "next/navigation"
import { useState, useEffect } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { Card } from "@/components/ui/card"
import { Loading } from "@/components/ui/loading"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface SearchResult {
  workspaceId: string
  workspaceFolder: string
  chatId: string
  chatTitle: string
  timestamp: string | number
  matchingText: string
  type: 'chat' | 'composer'
}

interface WorkspaceOption {
  id: string
  label: string
}

export default function SearchPage() {
  const searchParams = useSearchParams()
  const query = searchParams.get('q')
  const type = searchParams.get('type') || 'all'
  const workspace = searchParams.get('workspace') || 'all'
  const from = searchParams.get('from') || ''
  const to = searchParams.get('to') || ''
  const match = searchParams.get('match') || 'contains'
  const sort = searchParams.get('sort') || 'desc'
  const [results, setResults] = useState<SearchResult[]>([])
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([{ id: 'all', label: 'All workspaces' }])
  const [isLoading, setIsLoading] = useState(true)

  const updateSearchParams = (updates: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString())
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) {
        next.delete(key)
        return
      }
      next.set(key, value)
    })
    window.location.href = `/search?${next.toString()}`
  }

  useEffect(() => {
    const search = async () => {
      if (!query) return
      setIsLoading(true)
      try {
        const apiParams = new URLSearchParams({
          q: query,
          type,
          workspace,
          match,
          sort,
        })
        if (from) apiParams.set('from', from)
        if (to) apiParams.set('to', to)

        const response = await fetch(`/api/search?${apiParams.toString()}`)
        const data = await response.json()
        setResults(data.results || [])
        setWorkspaceOptions(data.workspaceOptions || [{ id: 'all', label: 'All workspaces' }])
      } catch (error) {
        console.error('Failed to search:', error)
      } finally {
        setIsLoading(false)
      }
    }
    search()
  }, [query, type, workspace, from, to, match, sort])

  if (!query) {
    return <div>No search query provided</div>
  }

  if (isLoading) {
    return <Loading message="Searching..." />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-4xl font-bold">Search Results</h1>
        <div className="flex gap-2">
          <Button 
            variant={type === 'all' ? 'default' : 'outline'}
            onClick={() => updateSearchParams({ type: 'all' })}
          >
            All
          </Button>
          <Button 
            variant={type === 'chat' ? 'default' : 'outline'}
            onClick={() => updateSearchParams({ type: 'chat' })}
          >
            Ask Logs
          </Button>
          <Button 
            variant={type === 'composer' ? 'default' : 'outline'}
            onClick={() => updateSearchParams({ type: 'composer' })}
          >
            Agent Logs
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-2">
            <label className="text-sm font-medium">Workspace</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={workspace}
              onChange={(event) => updateSearchParams({ workspace: event.target.value })}
            >
              {workspaceOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Match mode</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={match}
              onChange={(event) => updateSearchParams({ match: event.target.value })}
            >
              <option value="contains">Contains</option>
              <option value="exact">Exact</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Sort by time</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={sort}
              onChange={(event) => updateSearchParams({ sort: event.target.value })}
            >
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">From date</label>
            <Input
              type="date"
              value={from}
              onChange={(event) => updateSearchParams({ from: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">To date</label>
            <Input
              type="date"
              value={to}
              onChange={(event) => updateSearchParams({ to: event.target.value })}
            />
          </div>
        </div>
      </Card>

      <p className="text-muted-foreground">
        Found {results.length} results for &ldquo;{query}&rdquo;
      </p>

      <div className="space-y-4">
        {results.map((result, index) => (
          <Card key={index} className="p-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <Link
                  href={`/workspace/${result.workspaceId}?tab=${result.chatId}&type=${result.type}`}
                  className="text-lg font-medium hover:underline"
                >
                  {result.chatTitle}
                </Link>
                <div className="text-sm text-muted-foreground mt-1">
                  {format(new Date(result.timestamp), 'PPpp')}
                </div>
              </div>
              <Badge variant={result.type === 'chat' ? 'default' : 'secondary'}>
                {result.type === 'chat' ? 'Ask Log' : 'Agent Log'}
              </Badge>
            </div>
            <div className="text-sm mt-2">{result.matchingText}</div>
            {result.workspaceId === 'global' ? (
              <div className="text-xs text-blue-600 mt-2">
                🌐 Global Storage
              </div>
            ) : result.workspaceFolder && (
              <div className="text-xs text-muted-foreground mt-2">
                {result.workspaceFolder}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
} 