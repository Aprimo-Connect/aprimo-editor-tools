import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ArrowDown, ArrowUp, Check, Trash2, X } from "lucide-react"
import type { PackageConfig } from "../types"

type RuleResult = { hit: boolean }

type Props = {
  pkg: PackageConfig
  isFirst: boolean
  isLast: boolean
  hasZip: boolean
  isSelected: boolean
  isMatch: boolean
  isPartial: boolean
  isShadowed: boolean
  firstMatchName: string
  rules: string[]
  ruleResults: RuleResult[]
  onSelect: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  onDelete: () => void
  onPasteXml: () => void
}

export function PackageListCard({
  pkg, isFirst, isLast, hasZip, isSelected, isMatch, isPartial, isShadowed,
  firstMatchName, rules, ruleResults, onSelect, onMoveUp, onMoveDown, onEdit,
  onDelete, onPasteXml,
}: Props) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2 transition-colors cursor-pointer",
        isSelected
          ? "border-primary/60 bg-primary/5 ring-1 ring-primary/20"
          : isMatch
          ? "border-emerald-500/40 bg-emerald-50/20 dark:bg-emerald-950/10 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20"
          : isPartial
          ? "border-amber-400/40 hover:bg-muted/30"
          : "border-border bg-card hover:bg-muted/30"
      )}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {hasZip && rules.length > 0 && (
            isMatch
              ? <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              : isPartial
              ? <span className="text-amber-500 text-xs font-bold shrink-0">½</span>
              : <X className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
          )}
          <span className="font-medium text-sm truncate">{pkg.name}</span>
          {!pkg.enabled && (
            <Badge variant="secondary" className="text-xs shrink-0">disabled</Badge>
          )}
          {isMatch && (
            <Badge className="text-xs shrink-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 border">
              matches zip
            </Badge>
          )}
          {isShadowed && (
            <Badge className="text-xs shrink-0 bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30 border">
              hidden by &quot;{firstMatchName}&quot;
            </Badge>
          )}
        </div>
        <div
          className="flex items-center gap-0.5 shrink-0"
          onClick={e => e.stopPropagation()}
        >
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={isFirst} onClick={onMoveUp} title="Move up">
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={isLast} onClick={onMoveDown} title="Move down">
            <ArrowDown className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onPasteXml}>
            XML
          </Button>
          <Button
            size="sm" variant="ghost"
            className="h-7 w-7 p-0 text-destructive/60 hover:text-destructive hover:bg-destructive/10"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant={isSelected ? "default" : "outline"}
            className="h-7 px-3 text-xs"
            onClick={onEdit}
          >
            Edit
          </Button>
        </div>
      </div>

      {rules.length > 0 ? (
        <div className="space-y-0.5 pl-1">
          {rules.slice(0, 2).map((rule, j) => (
            <div key={j} className="flex items-center gap-2">
              {hasZip && (
                ruleResults[j].hit
                  ? <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                  : <X className="h-3 w-3 text-destructive/40 shrink-0" />
              )}
              <code className="text-xs font-mono text-muted-foreground truncate">{rule}</code>
            </div>
          ))}
          {rules.length > 2 && (
            <p className="text-xs text-muted-foreground ml-5">+{rules.length - 2} more rule{rules.length - 2 !== 1 ? "s" : ""}</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground pl-1">No identification rules</p>
      )}
    </div>
  )
}
