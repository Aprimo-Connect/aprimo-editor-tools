import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { FlaskConical, Package2, Plus, Trash2 } from "lucide-react"
import type { AdditionalFileConfig, ClassificationConfig, FocusedInput, PackageConfig, RecordConfig } from "../types"
import { KNOWN_PACKAGE_TYPES } from "../utils"
import { IdentificationTestResults } from "./identification-test-results"
import { RecordCard } from "./record-card"

type PackagePreset = { label: string; exts: string[]; regex: string }
type IdentResult = { rule: string; matches: string[] }

type Props = {
  config: PackageConfig
  zipPaths: string[]
  zipSuggestions: PackagePreset[]
  identTestResults: IdentResult[] | null
  setProp: <K extends keyof PackageConfig>(key: K, value: PackageConfig[K]) => void
  setFocusedInput: (input: FocusedInput) => void
  setIdentTestResults: (results: IdentResult[] | null) => void
  runIdentificationTest: () => void
  addIdentificationRule: (regex: string) => void
  addAdditionalFile: () => void
  setAF: (id: string, key: keyof AdditionalFileConfig, value: string) => void
  removeAF: (id: string) => void
  addRecord: () => void
  setRec: (id: string, key: keyof Omit<RecordConfig, "id" | "classifications">, value: string) => void
  removeRec: (id: string) => void
  addCls: (recId: string) => void
  setCls: (recId: string, clsId: string, key: keyof ClassificationConfig, value: string) => void
  removeCls: (recId: string, clsId: string) => void
  onViewPackages: () => void
  onAddPackage: () => void
}

export function ConfigureForm({
  config, zipPaths, zipSuggestions, identTestResults, setProp, setFocusedInput,
  setIdentTestResults, runIdentificationTest, addIdentificationRule,
  addAdditionalFile, setAF, removeAF, addRecord, setRec, removeRec,
  addCls, setCls, removeCls, onViewPackages, onAddPackage,
}: Props) {
  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center h-full">
        <Package2 className="h-8 w-8 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">No package selected</p>
          <p className="text-sm text-muted-foreground">
            Select a package from the Current Config tab, or create a new one.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onViewPackages}>View Packages</Button>
          <Button size="sm" onClick={onAddPackage}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New Package
          </Button>
        </div>
      </div>
    )
  }

  const presets = zipSuggestions.length > 0 ? zipSuggestions : KNOWN_PACKAGE_TYPES

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-8 max-w-2xl">

        {/* Package */}
        <section className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Package</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={config.name} onChange={e => setProp("name", e.target.value)} placeholder="e.g. InDesign" />
            </div>
            <div className="space-y-1.5">
              <Label>Package Content Type</Label>
              <div className="flex gap-2">
                <Select value={config.contentTypeMode} onValueChange={v => setProp("contentTypeMode", v as PackageConfig["contentTypeMode"])}>
                  <SelectTrigger className="w-28 shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="detect">Detect</SelectItem>
                    <SelectItem value="fixed">Fixed</SelectItem>
                    <SelectItem value="keep">Keep</SelectItem>
                  </SelectContent>
                </Select>
                {config.contentTypeMode === "fixed" && (
                  <Input value={config.contentTypeValue} onChange={e => setProp("contentTypeValue", e.target.value)} placeholder="Content type name" />
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="enabled" checked={config.enabled} onCheckedChange={v => setProp("enabled", v)} />
            <Label htmlFor="enabled">Enabled</Label>
          </div>
        </section>

        <Separator />

        {/* Identification Rules */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Identification Rules</h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!zipPaths.length || !config.identificationRules.some(r => r.trim())}
                onClick={runIdentificationTest}
                title={!zipPaths.length ? "Load a zip first" : ""}
              >
                <FlaskConical className="h-3.5 w-3.5 mr-1" /> Test Match
              </Button>
              <Button variant="outline" size="sm" onClick={() => setProp("identificationRules", [...config.identificationRules, ""])}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Rule
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Aprimo uses these regexes to detect the package type when a zip is uploaded. Multiple rules use AND logic — all must match.
          </p>

          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              {zipSuggestions.length > 0 ? "Detected in this zip — click to use:" : "Common package types — click to use:"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {presets.map(pt => {
                const alreadyAdded = config.identificationRules.includes(pt.regex)
                return (
                  <button
                    key={pt.regex}
                    disabled={alreadyAdded}
                    onClick={() => addIdentificationRule(pt.regex)}
                    className={cn(
                      "text-xs px-2 py-0.5 rounded border transition-colors font-mono",
                      alreadyAdded
                        ? "border-primary/40 bg-primary/10 text-primary cursor-default"
                        : "border-border hover:border-primary/50 text-muted-foreground hover:text-foreground"
                    )}
                    title={pt.regex}
                  >
                    {pt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            {config.identificationRules.map((rule, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={rule}
                  onChange={e => {
                    const next = [...config.identificationRules]
                    next[i] = e.target.value
                    setProp("identificationRules", next)
                    setIdentTestResults(null)
                  }}
                  onFocus={() => setFocusedInput({ kind: "identification", index: i })}
                  onBlur={() => setFocusedInput(null)}
                  placeholder="e.g. (.*?)\.(indd|indt)$"
                  className="font-mono text-sm"
                />
                {config.identificationRules.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                    onClick={() => setProp("identificationRules", config.identificationRules.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {identTestResults && (
            <IdentificationTestResults
              results={identTestResults}
              packageName={config.name}
              onDismiss={() => setIdentTestResults(null)}
            />
          )}
        </section>

        <Separator />

        {/* Primary File */}
        <section className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Primary File</h2>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>File Regex <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Input
                value={config.masterFileRegex}
                onChange={e => setProp("masterFileRegex", e.target.value)}
                onFocus={() => setFocusedInput({ kind: "masterFile" })}
                onBlur={() => setFocusedInput(null)}
                placeholder="e.g. (.*?)\.(indd|indt)$"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Preview Regex <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Input
                value={config.masterFilePreviewRegex}
                onChange={e => setProp("masterFilePreviewRegex", e.target.value)}
                onFocus={() => setFocusedInput({ kind: "masterPreview" })}
                onBlur={() => setFocusedInput(null)}
                placeholder="e.g. \\previews\\.*\.(jpeg|jpg|png)$"
                className="font-mono text-sm"
              />
            </div>
          </div>
        </section>

        <Separator />

        {/* Additional Files */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Additional Files</h2>
            <Button variant="outline" size="sm" onClick={addAdditionalFile}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
          {config.additionalFiles.length === 0 && (
            <p className="text-xs text-muted-foreground">No additional files configured.</p>
          )}
          <div className="space-y-3">
            {config.additionalFiles.map(af => (
              <div key={af.id} className="border border-border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Additional File</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeAF(af.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <Label>Regex</Label>
                  <Input
                    value={af.regex}
                    onChange={e => setAF(af.id, "regex", e.target.value)}
                    onFocus={() => setFocusedInput({ kind: "additional", id: af.id })}
                    onBlur={() => setFocusedInput(null)}
                    placeholder="e.g. document fonts\\(.*?)\.*$"
                    className="font-mono text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Purpose <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                    <Select value={af.purpose || "_none"} onValueChange={v => setAF(af.id, "purpose", v === "_none" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">None</SelectItem>
                        <SelectItem value="review">review</SelectItem>
                        <SelectItem value="spinset">spinset</SelectItem>
                        <SelectItem value="3dpreview">3dpreview</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Usages <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                    <Input value={af.usages} onChange={e => setAF(af.id, "usages", e.target.value)} placeholder="e.g. print" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <Separator />

        {/* Linked Records */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Linked Records</h2>
            <Button variant="outline" size="sm" onClick={addRecord}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
          {config.records.length === 0 && (
            <p className="text-xs text-muted-foreground">No linked records configured.</p>
          )}
          <div className="space-y-3">
            {config.records.map(rec => (
              <RecordCard
                key={rec.id}
                rec={rec}
                onChange={(key, value) => setRec(rec.id, key, value)}
                onRemove={() => removeRec(rec.id)}
                onFocusRegex={() => setFocusedInput({ kind: "record", id: rec.id })}
                onBlurRegex={() => setFocusedInput(null)}
                onAddCls={() => addCls(rec.id)}
                onSetCls={(clsId, key, value) => setCls(rec.id, clsId, key, value)}
                onRemoveCls={clsId => removeCls(rec.id, clsId)}
              />
            ))}
          </div>
        </section>

        <div className="pb-4" />
      </div>
    </ScrollArea>
  )
}
