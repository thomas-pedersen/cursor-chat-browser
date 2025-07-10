import { ChatTab } from "@/types/workspace"
import { marked } from 'marked'

export function convertChatToMarkdown(tab: ChatTab): string {
  let markdown = `# ${tab.title || `Chat ${tab.id}`}\n\n`
  markdown += `_Created: ${new Date(tab.timestamp).toLocaleString()}_\n\n---\n\n`
  
  tab.bubbles.forEach((bubble) => {
    // Add speaker
    markdown += `### ${bubble.type === 'ai' ? 'AI' : 'User'}\n\n`
    
    // Add message text or placeholder for empty AI messages
    if (bubble.text) {
      markdown += bubble.text + '\n\n'
    } else if (bubble.type === 'ai') {
      markdown += '_[TERMINAL OUTPUT NOT INCLUDED]_\n\n'
    }
    
    markdown += '---\n\n'
  })
  
  return markdown
}

export function downloadMarkdown(tab: ChatTab) {
  const markdown = convertChatToMarkdown(tab)
  const blob = new Blob([markdown], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${tab.title || `chat-${tab.id}`}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadHTML(tab: ChatTab) {
  const markdown = convertChatToMarkdown(tab)
  const htmlContent = marked(markdown)
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${tab.title || `Chat ${tab.id}`}</title>
      <style>
        body {
          max-width: 800px;
          margin: 40px auto;
          padding: 0 20px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          line-height: 1.6;
          color: #333;
        }
        pre {
          background: #f5f5f5;
          padding: 1em;
          overflow-x: auto;
          border-radius: 4px;
          border: 1px solid #ddd;
        }
        code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 0.9em;
        }
        hr {
          border: none;
          border-top: 1px solid #ddd;
          margin: 2em 0;
        }
        h1, h2, h3 {
          margin-top: 2em;
          margin-bottom: 1em;
        }
        blockquote {
          border-left: 4px solid #ddd;
          margin: 0;
          padding-left: 1em;
          color: #666;
        }
        em {
          color: #666;
        }
        @media (prefers-color-scheme: dark) {
          body {
            background: #1a1a1a;
            color: #ddd;
          }
          pre {
            background: #2d2d2d;
            border-color: #404040;
          }
          blockquote {
            border-color: #404040;
            color: #999;
          }
          em {
            color: #999;
          }
        }
      </style>
    </head>
    <body>
      ${htmlContent}
    </body>
  </html>
  `
  
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${tab.title || `chat-${tab.id}`}.html`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function downloadPDF(tab: ChatTab) {
  try {
    const markdown = convertChatToMarkdown(tab)
    const response = await fetch('/api/generate-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        markdown,
        title: tab.title || `Chat ${tab.id}`
      }),
    })

    if (!response.ok) {
      throw new Error('Failed to generate PDF')
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${tab.title || `chat-${tab.id}`}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Failed to download PDF:', error)
    alert('Failed to generate PDF. This feature is not yet implemented.')
  }
}

export function copyMarkdown(tab: ChatTab) {
  const markdown = convertChatToMarkdown(tab)
  navigator.clipboard.writeText(markdown)
}