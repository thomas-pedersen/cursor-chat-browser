"use client"

import Link from "next/link"
import { ThemeToggle } from "./theme-toggle"
import { GlobalSearch } from "./global-search"

export function Navbar() {
  return (
    <nav className="border-b">
      <div className="flex h-16 items-center px-4">
        <Link href="/" className="flex items-center space-x-2">
          <span className="font-bold text-xl">Cursor Chat Browser</span>
        </Link>
        <div className="ml-auto flex items-center space-x-4">
          <GlobalSearch />
          <ThemeToggle />
        </div>
      </div>
    </nav>
  )
}
