import { WorkspaceList } from "@/components/workspace-list"

export default function Home() {
  return (
    <div>
      <h1 className="text-4xl font-bold mb-4">Projects</h1>
      <p className="text-muted-foreground mb-8">
        Browse your Cursor chat conversations by project. Click on a project to view its conversations.
      </p>
      <WorkspaceList />
    </div>
  )
} 