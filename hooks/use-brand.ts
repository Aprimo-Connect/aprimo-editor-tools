"use client"

import { useState, useEffect } from "react"

export type Brand = "teal" | "aprimo"

export function useBrand() {
  const [brand, setBrandState] = useState<Brand>("teal")

  useEffect(() => {
    const stored = localStorage.getItem("brand") as Brand | null
    const active = stored === "aprimo" ? "aprimo" : "teal"
    setBrandState(active)
    if (active === "aprimo") {
      document.documentElement.classList.add("aprimo")
    }
  }, [])

  function setBrand(b: Brand) {
    setBrandState(b)
    localStorage.setItem("brand", b)
    if (b === "aprimo") {
      document.documentElement.classList.add("aprimo")
    } else {
      document.documentElement.classList.remove("aprimo")
    }
  }

  return { brand, setBrand }
}
