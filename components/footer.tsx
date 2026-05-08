import { Activity } from "lucide-react"

export function Footer() {
  return (
    <footer className="border-t border-border bg-background py-8">
      <div className="px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-foreground">
            <Activity className="h-5 w-5 text-primary" />
            <span className="font-semibold">Aprimo Editor Tools</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Open source &mdash;{" "}
            <a
              href="https://github.com/Aprimo-Connect/aprimo-editor-tools"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              view on GitHub
            </a>
            {" "}&mdash; &copy; 2026 Aprimo
          </p>
        </div>
      </div>
    </footer>
  )
}
