import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trash2, Plus } from "lucide-react"
import type { RecordConfig, ClassificationConfig } from "../types"

type Props = {
  rec: RecordConfig
  onChange: (key: keyof Omit<RecordConfig, "id" | "classifications">, value: string) => void
  onRemove: () => void
  onFocusRegex: () => void
  onBlurRegex: () => void
  onAddCls: () => void
  onSetCls: (clsId: string, key: keyof ClassificationConfig, value: string) => void
  onRemoveCls: (clsId: string) => void
}

export function RecordCard({ rec, onChange, onRemove, onFocusRegex, onBlurRegex, onAddCls, onSetCls, onRemoveCls }: Props) {
  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Linked Record</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label>Regex</Label>
        <Input
          value={rec.regex}
          onChange={e => onChange("regex", e.target.value)}
          onFocus={onFocusRegex}
          onBlur={onBlurRegex}
          placeholder="e.g. links\\(.*?)\.*$"
          className="font-mono text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Link Type</Label>
          <Select value={rec.linkType} onValueChange={v => onChange("linkType", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pubItem">pubItem</SelectItem>
              <SelectItem value="recordLink">recordLink</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Check Duplicate</Label>
          <Select value={rec.checkDuplicate || "FileNameAndContent"} onValueChange={v => onChange("checkDuplicate", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="FileNameAndContent">FileNameAndContent</SelectItem>
              <SelectItem value="FileName">FileName</SelectItem>
              <SelectItem value="FileContent">FileContent</SelectItem>
              <SelectItem value="false">false (always create)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {rec.linkType === "recordLink" && (
        <div className="space-y-1.5">
          <Label>Link Field</Label>
          <Input value={rec.linkField} onChange={e => onChange("linkField", e.target.value)} placeholder="Field name" />
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Record Content Type</Label>
        <div className="flex gap-2">
          <Select value={rec.contentTypeMode} onValueChange={v => onChange("contentTypeMode", v)}>
            <SelectTrigger className="w-28 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="detect">Detect</SelectItem>
              <SelectItem value="fixed">Fixed</SelectItem>
            </SelectContent>
          </Select>
          {rec.contentTypeMode === "fixed" && (
            <Input value={rec.contentTypeValue} onChange={e => onChange("contentTypeValue", e.target.value)} placeholder="Content type name" />
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Classifications</Label>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onAddCls}>
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
        </div>
        {rec.classifications.map(cls => (
          <div key={cls.id} className="flex gap-2 items-center">
            <Select value={cls.type} onValueChange={v => onSetCls(cls.id, "type", v)}>
              <SelectTrigger className="w-36 shrink-0 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sameAsMaster">sameAsMaster</SelectItem>
                <SelectItem value="identifier">identifier</SelectItem>
                <SelectItem value="namePath">namePath</SelectItem>
              </SelectContent>
            </Select>
            {cls.type !== "sameAsMaster" && (
              <Input
                value={cls.value}
                onChange={e => onSetCls(cls.id, "value", e.target.value)}
                placeholder={cls.type === "namePath" ? "/path/to/class" : "identifier"}
                className="flex-1 text-sm min-w-0"
              />
            )}
            <Select value={cls.option || "_all"} onValueChange={v => onSetCls(cls.id, "option", v === "_all" ? "" : v)}>
              <SelectTrigger className="w-32 shrink-0 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">Always</SelectItem>
                <SelectItem value="newOnly">newOnly</SelectItem>
                <SelectItem value="duplicateOnly">duplicateOnly</SelectItem>
              </SelectContent>
            </Select>
            {rec.classifications.length > 1 && (
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onRemoveCls(cls.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
