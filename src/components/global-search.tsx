"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Search, MessageSquare, Sparkles, Clock, ArrowRight } from "lucide-react"
import { format } from "date-fns"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface SearchResult {
  workspaceId: string
  workspaceFolder: string
  chatId: string
  chatTitle: string
  timestamp: string | number
  matchingText: string
  type: 'chat' | 'composer'
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filter, setFilter] = useState<'all' | 'chat' | 'composer'>('all')
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Keyboard shortcut to open search
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setQuery("")
      setResults([])
      setSelectedIndex(0)
    }
  }, [open])

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }

    const timer = setTimeout(async () => {
      setIsLoading(true)
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=${filter}`)
        const data = await response.json()
        setResults(data.results || [])
        setSelectedIndex(0)
      } catch (error) {
        console.error('Search failed:', error)
      } finally {
        setIsLoading(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query, filter])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault()
      navigateToResult(results[selectedIndex])
    }
  }, [results, selectedIndex])

  const navigateToResult = (result: SearchResult) => {
    setOpen(false)
    router.push(`/workspace/${result.workspaceId}?tab=${result.chatId}&type=${result.type}`)
  }

  const truncateText = (text: string, maxLength: number = 100) => {
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength) + "..."
  }

  return (
    <>
      {/* Search trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-lg border border-input bg-background hover:bg-accent group"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline-block">Search all projects...</span>
        <kbd className="hidden md:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
          <DialogTitle className="sr-only">Search across all projects</DialogTitle>
          
          {/* Search input header */}
          <div className="flex items-center border-b px-4">
            <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Search across all projects and conversations..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 border-0 bg-transparent px-3 py-4 text-base focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            {isLoading && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 px-4 py-2 border-b bg-muted/30">
            {(['all', 'chat', 'composer'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  filter === type
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {type === 'all' ? 'All' : type === 'chat' ? 'Ask Logs' : 'Agent Logs'}
              </button>
            ))}
          </div>

          {/* Results */}
          <div className="max-h-[400px] overflow-y-auto">
            {query && results.length === 0 && !isLoading && (
              <div className="py-12 text-center">
                <Search className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">No results found for &ldquo;{query}&rdquo;</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Try a different search term</p>
              </div>
            )}

            {!query && (
              <div className="py-12 text-center">
                <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">Start typing to search</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  Search across all your projects and conversations
                </p>
              </div>
            )}

            {results.length > 0 && (
              <div className="py-2">
                <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground">
                  {results.length} result{results.length !== 1 ? 's' : ''} found
                </div>
                {results.map((result, index) => (
                  <button
                    key={`${result.workspaceId}-${result.chatId}`}
                    onClick={() => navigateToResult(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors",
                      selectedIndex === index
                        ? "bg-accent"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <div className={cn(
                      "shrink-0 mt-0.5 p-2 rounded-lg",
                      result.type === 'chat' 
                        ? "bg-blue-500/10 text-blue-500" 
                        : "bg-purple-500/10 text-purple-500"
                    )}>
                      {result.type === 'chat' 
                        ? <MessageSquare className="h-4 w-4" /> 
                        : <Sparkles className="h-4 w-4" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium truncate">{result.chatTitle}</span>
                        <Badge 
                          variant={result.type === 'chat' ? 'default' : 'secondary'}
                          className="shrink-0 text-[10px] px-1.5 py-0"
                        >
                          {result.type === 'chat' ? 'Ask' : 'Agent'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {truncateText(result.matchingText)}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground/70">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(result.timestamp), 'MMM d, yyyy')}
                        </span>
                        {result.workspaceId === 'global' ? (
                          <span className="text-blue-500">🌐 Global</span>
                        ) : result.workspaceFolder && (
                          <span className="truncate max-w-[200px]">
                            {result.workspaceFolder.replace('file://', '').split('/').pop()}
                          </span>
                        )}
                      </div>
                    </div>
                    <ArrowRight className={cn(
                      "h-4 w-4 shrink-0 mt-2 transition-opacity",
                      selectedIndex === index ? "opacity-100" : "opacity-0"
                    )} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t px-4 py-2 bg-muted/30">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded border bg-background text-[10px]">↑</kbd>
                <kbd className="px-1.5 py-0.5 rounded border bg-background text-[10px]">↓</kbd>
                <span>Navigate</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded border bg-background text-[10px]">↵</kbd>
                <span>Open</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded border bg-background text-[10px]">esc</kbd>
                <span>Close</span>
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
