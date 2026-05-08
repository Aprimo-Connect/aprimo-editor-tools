export function extractRecordIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(
    /aprimocdn\.net\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  )
  if (m) return m[1].replace(/-/g, "")
  const m2 = url.match(/\/([0-9a-f]{32})\b/i)
  return m2 ? m2[1] : null
}

export function extractSubdomainFromCdnUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/aprimocdn\.net\/([^/]+)\/[0-9a-f]/i)
  return m ? m[1] : null
}
