export function Footer() {
  return (
    <footer className="border-t border-border bg-background py-8">
      <div className="px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-foreground">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className="h-5 w-5" fill="none" stroke="#217FC7" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M34,14 H30 A8,8 0 0 0 22,22 V42 A8,8 0 0 1 14,50 A8,8 0 0 1 22,58 V78 A8,8 0 0 0 30,86 H34"/>
              <path d="M66,86 H70 A8,8 0 0 0 78,78 V58 A8,8 0 0 1 86,50 A8,8 0 0 1 78,42 V22 A8,8 0 0 0 70,14 H66"/>
            </svg>
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
