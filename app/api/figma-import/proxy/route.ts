import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"

// Only proxy HTTPS URLs from Figma's known S3 CDN hostnames.
// Figma image URLs use multi-level subdomains, e.g.:
//   figma-alpha-api.s3.us-west-2.amazonaws.com
function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    const h = u.hostname
    return (
      u.protocol === "https:" &&
      (h.endsWith(".amazonaws.com") || h.endsWith(".figma.com")) &&
      h !== "amazonaws.com" && h !== "figma.com"
    )
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const token = (await cookies()).get("figma_token")?.value
  if (!token) return new NextResponse("Unauthorized", { status: 401 })

  const rawUrl = req.nextUrl.searchParams.get("url") ?? ""
  if (!rawUrl) return new NextResponse("Missing url param", { status: 400 })
  if (!isAllowedUrl(rawUrl)) return new NextResponse("URL not allowed", { status: 403 })

  const upstream = await fetch(rawUrl)
  if (!upstream.ok) {
    return new NextResponse("Failed to fetch image from Figma", { status: 502 })
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/png",
      "Cache-Control": "private, max-age=300",
    },
  })
}
