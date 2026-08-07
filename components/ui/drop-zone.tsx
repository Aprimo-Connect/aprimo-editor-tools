import { cn } from "@/lib/utils"
import { Upload } from "lucide-react"

type Props = {
  isDragging: boolean
  onDragOver: () => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onClick?: () => void
  label?: string
  sublabel?: string
  className?: string
  children?: React.ReactNode
}

export function DropZone({
  isDragging, onDragOver, onDragLeave, onDrop, onClick,
  label = "Drop a file here",
  sublabel = "or click to browse",
  className,
  children,
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center border-2 border-dashed rounded-lg cursor-pointer transition-colors",
        isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30",
        className,
      )}
      onDragOver={e => { e.preventDefault(); onDragOver() }}
      onDragLeave={onDragLeave}
      onDrop={e => { e.preventDefault(); onDrop(e) }}
      onClick={onClick}
    >
      {children ?? (
        <>
          <Upload className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm font-medium">{label}</p>
          {sublabel && <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>}
        </>
      )}
    </div>
  )
}
