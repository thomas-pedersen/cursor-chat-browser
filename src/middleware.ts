import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Redirect root to home page
  if (request.nextUrl.pathname === '/') {
    return NextResponse.next()
  }

  // Redirect /chat to home page since we deleted that route
  if (request.nextUrl.pathname === '/chat') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
} 