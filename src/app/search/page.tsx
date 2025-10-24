"use client"

import { useSearchParams } from "next/navigation"
import { useState, useEffect } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { Card } from "@/components/ui/card"
import { Loading } from "@/components/ui/loading"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface SearchResult {
  workspaceId: string
  workspaceFolder: string
  chatId: string
  chatTitle: string
  timestamp: string | number
  matchingText: string
  type: 'chat' | 'composer'
}

export default function SearchPage() {
  const searchParams = useSearchParams()
  const query = searchParams.get('q')
  const type = searchParams.get('type') || 'all'
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const search = async () => {
      if (!query) return
      setIsLoading(true)
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=${type}`)
        const data = await response.json()
        setResults(data.results || [])
      } catch (error) {
        console.error('Failed to search:', error)
      } finally {
        setIsLoading(false)
      }
    }
    search()
  }, [query, type])

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
            onClick={() => window.location.href = `/search?q=${query}&type=all`}
          >
            All
          </Button>
          <Button 
            variant={type === 'chat' ? 'default' : 'outline'}
            onClick={() => window.location.href = `/search?q=${query}&type=chat`}
          >
            Ask Logs
          </Button>
          <Button 
            variant={type === 'composer' ? 'default' : 'outline'}
            onClick={() => window.location.href = `/search?q=${query}&type=composer`}
          >
            Agent Logs
          </Button>
        </div>
      </div>

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