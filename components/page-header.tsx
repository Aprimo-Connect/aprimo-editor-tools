"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight } from "lucide-react"

const routeLabels: Record<string, string> = {
  "excel-import": "Excel Import",
  "bulk-upload": "Bulk Upload",
  "my-item": "My Item",
  "my-basket": "My Basket",
  "basket-editor": "Basket Editor",
  "video-resizer": "Video Resizer",
  "video-studio": "Video Studio",
}

export function PageHeader() {
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean)

  if (segments.length === 0) return null

  const crumbs = [
    { label: "Home", href: "/" },
    ...segments.map((seg, i) => ({
      label: routeLabels[seg] ?? seg,
      href: "/" + segments.slice(0, i + 1).join("/"),
    })),
  ]
  const pageTitle = routeLabels[segments[segments.length - 1]] ?? segments[segments.length - 1]

  return (
    <div className="border-b border-border bg-background">
      <div className="px-6 py-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
          {crumbs.map((crumb, i) => (
            <span key={crumb.href} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              {i < crumbs.length - 1 ? (
                <Link href={crumb.href} className="hover:text-foreground transition-colors">
                  {crumb.label}
                </Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </div>
        <h1 className="text-xl font-semibold">{pageTitle}</h1>
      </div>
    </div>
  )
}
