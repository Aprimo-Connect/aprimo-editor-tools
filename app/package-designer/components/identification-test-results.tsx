import { cn } from "@/lib/utils"
import { Check, ChevronDown, X } from "lucide-react"
import { useState } from "react"

type RuleResult = { rule: string; matches: string[] }

type Props = {
  results: RuleResult[]
  packageName: string
  onDismiss: () => void
}

export function IdentificationTestResults({ results, packageName, onDismiss }: Props) {
  const [expandedRule, setExpandedRule] = useState<number | null>(null)
  const allPassed = results.every(r => r.matches.length > 0)

  return (
    <div className="rounded-lg border border-border p-3 space-y-2.5 bg-muted/20">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Test Results</span>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2">
        {results.map((r, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-2">
              {r.matches.length > 0
                ? <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                : <X className="h-3.5 w-3.5 text-destructive shrink-0" />}
              <code className="text-xs font-mono text-muted-foreground truncate flex-1 min-w-0">{r.rule}</code>
              {r.matches.length > 0 && (
                <button
                  onClick={() => setExpandedRule(expandedRule === i ? null : i)}
                  className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 shrink-0 hover:underline"
                >
                  {r.matches.length} file{r.matches.length !== 1 ? "s" : ""}
                  <ChevronDown className={cn("h-3 w-3 transition-transform", expandedRule === i && "rotate-180")} />
                </button>
              )}
              {r.matches.length === 0 && (
                <span className="text-xs text-destructive shrink-0">no match</span>
              )}
            </div>
            {expandedRule === i && (
              <div className="ml-5 space-y-0.5 max-h-32 overflow-y-auto">
                {r.matches.map(m => (
                  <div key={m} className="text-xs font-mono text-muted-foreground truncate">{m}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={cn(
        "flex items-center gap-2 pt-2 border-t border-border text-xs font-semibold",
        allPassed ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
      )}>
        {allPassed
          ? <Check className="h-3.5 w-3.5 shrink-0" />
          : <X className="h-3.5 w-3.5 shrink-0" />}
        {allPassed
          ? `This zip would be identified as "${packageName}"`
          : `Would NOT be identified — ${results.filter(r => r.matches.length > 0).length} of ${results.length} rules matched`}
      </div>
    </div>
  )
}
