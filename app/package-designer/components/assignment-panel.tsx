import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { ChevronRight, File as FileIcon, Folder as FolderIcon, X } from "lucide-react"
import type { AssignRole, PackageConfig } from "../types"
import { describePattern, nextSegmentMode, type PathSegment } from "../utils"

type Props = {
  selectedPath: string
  selectedIsFolder: boolean
  selectedConfig: PackageConfig | null
  segments: PathSegment[]
  isRawMode: boolean
  rawRegex: string
  derivedRegex: string
  activeRegex: string
  focusedMatchCount: number
  assignRole: AssignRole
  assignPurpose: string
  assignUsages: string
  onDeselect: () => void
  onSetSegments: (updater: (prev: PathSegment[]) => PathSegment[]) => void
  onSetRawRegex: (v: string) => void
  onToggleRawMode: () => void
  onSetAssignRole: (v: AssignRole) => void
  onSetAssignPurpose: (v: string) => void
  onSetAssignUsages: (v: string) => void
  onApply: () => void
}

export function AssignmentPanel({
  selectedPath, selectedIsFolder, selectedConfig, segments, isRawMode,
  rawRegex, derivedRegex, activeRegex, focusedMatchCount, assignRole,
  assignPurpose, assignUsages, onDeselect, onSetSegments, onSetRawRegex,
  onToggleRawMode, onSetAssignRole, onSetAssignPurpose, onSetAssignUsages, onApply,
}: Props) {
  return (
    <div className="border-t border-border bg-muted/20 p-3 space-y-3 shrink-0">
      <div className="flex items-center gap-2">
        {selectedIsFolder
          ? <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="text-xs font-mono truncate flex-1 min-w-0 text-foreground">{selectedPath}</span>
        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={onDeselect}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      {!selectedConfig && (
        <p className="text-xs text-muted-foreground">
          Select a package in the Current Config tab to assign this file.
        </p>
      )}

      {selectedConfig && (
        <>
          {/* Visual segment builder */}
          {!isRawMode ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1 flex-wrap">
                {segments.map((seg, i) => {
                  const display =
                    seg.mode === "exact" ? seg.text :
                    seg.mode === "extension" ? `*.${seg.ext}` : "*"
                  const tooltip =
                    seg.mode === "exact"
                      ? (seg.isFile && seg.ext ? `click → *.${seg.ext}` : "click → *")
                      : seg.mode === "extension" ? "click → *"
                      : "click → exact"
                  return (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                      <button
                        title={tooltip}
                        onClick={() => onSetSegments(prev => prev.map((s, j) =>
                          j === i ? { ...s, mode: nextSegmentMode(s) } : s
                        ))}
                        className={cn(
                          "text-xs px-2 py-0.5 rounded border font-mono transition-all",
                          seg.mode === "exact" && "border-border bg-background text-foreground hover:border-primary/50",
                          seg.mode === "extension" && "border-blue-400/60 bg-blue-50/60 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-dashed",
                          seg.mode === "wildcard" && "border-amber-400/60 bg-amber-50/60 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-dashed",
                        )}
                      >
                        {display}
                      </button>
                    </span>
                  )
                })}
                {selectedIsFolder && (
                  <span className="flex items-center gap-1">
                    <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground font-mono">…</span>
                  </span>
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-snug">
                {describePattern(segments, selectedIsFolder)}
              </p>

              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 border border-border rounded bg-background" />
                  exact
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 border border-dashed border-blue-400/60 rounded bg-blue-50/60 dark:bg-blue-900/20" />
                  extension
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 border border-dashed border-amber-400/60 rounded bg-amber-50/60 dark:bg-amber-900/20" />
                  wildcard
                </span>
              </div>
            </div>
          ) : (
            <Input
              value={rawRegex}
              onChange={e => onSetRawRegex(e.target.value)}
              className="font-mono text-xs h-8"
              placeholder="regex pattern"
              autoFocus
            />
          )}

          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 text-xs font-mono bg-background border border-border px-2 py-1 rounded truncate text-muted-foreground">
              {activeRegex || "—"}
            </code>
            <span className={cn(
              "text-xs tabular-nums shrink-0",
              focusedMatchCount > 0 ? "text-primary font-medium" : "text-muted-foreground"
            )}>
              {focusedMatchCount}✓
            </span>
            <button
              onClick={() => {
                if (!isRawMode) { onSetRawRegex(derivedRegex); onToggleRawMode() }
                else onToggleRawMode()
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
              title={isRawMode ? "Back to visual" : "Edit regex directly"}
            >
              {isRawMode ? "visual" : "edit"}
            </button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Assign as</Label>
            <Select value={assignRole} onValueChange={v => onSetAssignRole(v as AssignRole)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Choose role…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="identification">Identification Rule</SelectItem>
                <SelectItem value="master">Primary File</SelectItem>
                <SelectItem value="preview">Preview</SelectItem>
                <SelectItem value="additional">Additional File</SelectItem>
                <SelectItem value="record">Linked Record</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {assignRole === "additional" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Purpose</Label>
                <Select value={assignPurpose || "_none"} onValueChange={v => onSetAssignPurpose(v === "_none" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">None</SelectItem>
                    <SelectItem value="review">review</SelectItem>
                    <SelectItem value="spinset">spinset</SelectItem>
                    <SelectItem value="3dpreview">3dpreview</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Usages</Label>
                <Input value={assignUsages} onChange={e => onSetAssignUsages(e.target.value)} className="h-8 text-xs" placeholder="e.g. print" />
              </div>
            </div>
          )}

          <Button
            size="sm"
            className="w-full h-8"
            disabled={!assignRole || !activeRegex.trim()}
            onClick={onApply}
          >
            Apply
          </Button>
        </>
      )}
    </div>
  )
}
