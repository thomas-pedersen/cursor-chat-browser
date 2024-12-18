import { ChatTab } from "@/types/workspace"
import { marked } from 'marked'
import JSZip from 'jszip'

export function convertChatToMarkdown(tab: ChatTab): string {
  let markdown = `# ${tab.title || `Chat ${tab.id}`}\n\n`
  markdown += `_Created: ${new Date(tab.timestamp).toLocaleString()}_\n\n---\n\n`
  
  tab.bubbles.forEach((bubble) => {
    // Add speaker
    markdown += `### ${bubble.type === 'ai' ? `AI (${bubble.modelType})` : 'User'}\n\n`
    
    // Add selections if any
    if (bubble.selections?.length) {
      markdown += '**Selected Code:**\n\n'
      bubble.selections.forEach((selection) => {
        markdown += '```\n' + selection.text + '\n```\n\n'
      })
    }
    
    // Add message text
    if (bubble.text) {
      markdown += bubble.text + '\n\n'
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
  const html = marked(markdown)
  const fullHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${tab.title || `Chat ${tab.id}`}</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
          pre { background: #f6f8fa; padding: 1rem; border-radius: 6px; overflow-x: auto; }
          hr { border: 0; border-top: 1px solid #eaecef; margin: 2rem 0; }
        </style>
      </head>
      <body>${html}</body>
    </html>
  `
  const blob = new Blob([fullHtml], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${tab.title || `chat-${tab.id}`}.html`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadPDF(tab: ChatTab) {
  const markdown = convertChatToMarkdown(tab)
  const html = marked(markdown)
  const style = `
    <style>
      body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
      pre { background: #f6f8fa; padding: 1rem; border-radius: 6px; overflow-x: auto; }
      hr { border: 0; border-top: 1px solid #eaecef; margin: 2rem 0; }
    </style>
  `
  const printWindow = window.open('', '', 'width=800,height=600')
  if (printWindow) {
    printWindow.document.write(style + html)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => {
      printWindow.print()
      printWindow.close()
    }, 250)
  }
}

export async function downloadAllAsZip(format: 'markdown' | 'html' | 'pdf') {
  try {
    console.log('Fetching all workspaces...')
    const response = await fetch('/api/workspaces')
    const workspaces = await response.json()
    console.log(`Found ${workspaces.length} workspaces to process`)
    
    const zip = new JSZip()
    let totalFiles = 0
    
    for (const [index, workspace] of workspaces.entries()) {
      console.log(`Processing workspace ${index + 1}/${workspaces.length}: ${workspace.id}`)
      const tabsResponse = await fetch(`/api/workspaces/${workspace.id}/tabs`)
      const { tabs, composers } = await tabsResponse.json()
      
      if (tabs?.length > 0) {
        console.log(`Found ${tabs.length} chat logs in workspace ${workspace.id}`)
        const wsFolder = zip.folder(workspace.id)
        if (!wsFolder) continue
        
        for (const [tabIndex, tab] of tabs.entries()) {
          const content = format === 'markdown' 
            ? convertChatToMarkdown(tab)
            : format === 'html' 
              ? marked(convertChatToMarkdown(tab))
              : convertChatToMarkdown(tab) // PDF not supported in zip, fallback to markdown
              
          const extension = format === 'html' ? 'html' : 'md'
          const fileName = `${tab.title || `chat-${tab.id}`}.${extension}`
          
          if (format === 'html') {
            const fullHtml = `
              <!DOCTYPE html>
              <html>
                <head>
                  <meta charset="utf-8">
                  <title>${tab.title || `Chat ${tab.id}`}</title>
                  <style>
                    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
                    pre { background: #f6f8fa; padding: 1rem; border-radius: 6px; overflow-x: auto; }
                    hr { border: 0; border-top: 1px solid #eaecef; margin: 2rem 0; }
                  </style>
                </head>
                <body>${content}</body>
              </html>
            `
            wsFolder.file(fileName, fullHtml)
          } else {
            wsFolder.file(fileName, content)
          }
          totalFiles++
          console.log(`Added file ${tabIndex + 1}/${tabs.length}: ${fileName}`)
        }
      }
    }
    
    console.log(`Generating zip file with ${totalFiles} files...`)
    const blob = await zip.generateAsync({ type: 'blob' })
    console.log('Zip file generated, initiating download...')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cursor-logs.${format === 'html' ? 'html' : 'md'}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    console.log('Download complete!')
  } catch (error) {
    console.error('Failed to download all logs:', error)
  }
}

export function copyMarkdown(tab: ChatTab) {
  const markdown = convertChatToMarkdown(tab)
  navigator.clipboard.writeText(markdown)
}