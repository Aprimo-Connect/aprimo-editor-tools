"use client"

import { useBrand } from "@/hooks/use-brand"

export function BrandToggle() {
  const { brand, setBrand } = useBrand()

  return (
    <div className="flex items-center rounded-md border border-border p-0.5 text-xs font-medium">
      <button
        onClick={() => setBrand("teal")}
        className={`px-2 py-1 rounded transition-colors ${
          brand === "teal"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        AMP
      </button>
      <button
        onClick={() => setBrand("aprimo")}
        className={`px-2 py-1 rounded transition-colors ${
          brand === "aprimo"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Aprimo
      </button>
    </div>
  )
}
