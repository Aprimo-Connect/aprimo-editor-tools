import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronRight, File as FileIcon, FolderOpen, Folder as FolderIcon } from "lucide-react"
import { FileRole, getFileRolesAndLinks, ROLE_COLOR, ROLE_LABEL } from "../utils"
import type { PackageConfig, TreeNode } from "../types"

type Props = {
  node: TreeNode
  depth: number
  config: PackageConfig
  expandedPaths: Set<string>
  focusedMatches: Set<string>
  selectedPath: string | null
  onToggle: (path: string) => void
  onSelect: (path: string, isFolder: boolean) => void
}

export function FileTreeNode({ node, depth, config, expandedPaths, focusedMatches, selectedPath, onToggle, onSelect }: Props) {
  const isExpanded = expandedPaths.has(node.path)
  const { roles, recordLinkTypes } = !node.isFolder
    ? getFileRolesAndLinks(node.path, config)
    : { roles: [] as FileRole[], recordLinkTypes: [] as Array<"pubItem" | "recordLink"> }
  const hasConflict = roles.length > 1
  const isFocusedMatch = focusedMatches.has(node.path)
  const isSelected = selectedPath === node.path

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 py-0.5 rounded text-sm select-none cursor-pointer transition-colors",
          "hover:bg-muted/40",
          !hasConflict && roles[0] && ROLE_COLOR[roles[0]],
          hasConflict && "text-orange-600 dark:text-orange-400",
          isFocusedMatch && "bg-yellow-100/60 dark:bg-yellow-900/30 ring-1 ring-inset ring-yellow-400/40",
          isSelected && "bg-primary/10 ring-1 ring-inset ring-primary/30 !text-foreground",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px`, paddingRight: 8 }}
        onClick={() => onSelect(node.path, node.isFolder)}
      >
        {node.isFolder ? (
          <span
            className="flex items-center gap-1 shrink-0"
            onClick={e => { e.stopPropagation(); onToggle(node.path) }}
          >
            {isExpanded
              ? <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              : <ChevronRight className="h-3.5 w-3.5 opacity-50" />}
            {isExpanded
              ? <FolderOpen className="h-3.5 w-3.5" />
              : <FolderIcon className="h-3.5 w-3.5" />}
          </span>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            <FileIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </>
        )}
        <span className="truncate flex-1 min-w-0">{node.name}</span>
        {!isSelected && roles.length > 0 && (
          <span className="flex items-center gap-0.5 ml-1 shrink-0">
            {roles.flatMap(r => {
              if (r === "record") {
                const types = recordLinkTypes.length > 0 ? recordLinkTypes : ["pubItem" as const]
                return types.map((lt, i) => (
                  <Badge
                    key={`record-${i}`}
                    variant="outline"
                    className={cn("text-[10px] px-1 py-0 h-4 border-current", ROLE_COLOR[r])}
                  >
                    {lt === "pubItem" ? "linked-pubItem" : "linked-recordLink"}
                  </Badge>
                ))
              }
              return [
                <Badge
                  key={r}
                  variant="outline"
                  className={cn("text-[10px] px-1 py-0 h-4 border-current", ROLE_COLOR[r])}
                >
                  {ROLE_LABEL[r]}
                </Badge>
              ]
            })}
          </span>
        )}
      </div>

      {node.isFolder && isExpanded && node.children.map(child => (
        <FileTreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          config={config}
          expandedPaths={expandedPaths}
          focusedMatches={focusedMatches}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
