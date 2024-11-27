import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import { downloadAllAsZip } from "@/lib/download"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip"

export function DownloadAllMenu() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Download className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => downloadAllAsZip('markdown')}>
              Download All as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => downloadAllAsZip('html')}>
              Download All as HTML
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => downloadAllAsZip('pdf')}>
              Download All as PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipTrigger>
      <TooltipContent>
        Download All Logs
      </TooltipContent>
    </Tooltip>
  )
} 