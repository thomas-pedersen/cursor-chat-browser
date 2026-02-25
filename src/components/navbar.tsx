"use client"

import { FormEvent, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ThemeToggle } from "./theme-toggle"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export function Navbar() {
  const [query, setQuery] = useState("")
  const router = useRouter()

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    router.push(`/search?q=${encodeURIComponent(trimmed)}&type=all`)
  }

  return (
    <nav className="border-b">
      <div className="flex h-16 items-center gap-4 px-4">
        <Link href="/" className="flex items-center space-x-2">
          <span className="font-bold text-xl">Cursor Chat Browser</span>
        </Link>
        <form onSubmit={handleSearch} className="ml-auto flex w-full max-w-xl items-center gap-2">
          <Input
            type="search"
            placeholder="Search ask and agent logs..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button type="submit">Search</Button>
        </form>
        <div className="flex items-center space-x-4">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  )
} 