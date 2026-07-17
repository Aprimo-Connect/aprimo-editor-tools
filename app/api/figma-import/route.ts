import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  parseFigmaUrl,
  listFrames,
  fetchDocument,
  getImageFills,
  collectVectorIds,
  getSvgExports,
  nodeToLayout,
} from "@/lib/figma-api"

const TOKEN_COOKIE = "figma_token"

async function getToken(): Promise<string | undefined> {
  return (await cookies()).get(TOKEN_COOKIE)?.value
}

// GET — connection check (validates token with a lightweight Figma API call)
export async function GET() {
  const token = await getToken()
  if (!token) return NextResponse.json({ connected: false })
  try {
    const probe = await fetch("https://api.figma.com/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (probe.status === 401 || probe.status === 403) {
      const res = NextResponse.json({ connected: false })
      res.cookies.delete("figma_token")
      return res
    }
    return NextResponse.json({ connected: true })
  } catch {
    // Network error — assume connected to avoid re-auth on transient failures
    return NextResponse.json({ connected: true })
  }
}

// POST — list frames (action:"frames") or import a layout
export async function POST(req: NextRequest) {
  const token = await getToken()
  if (!token) return NextResponse.json({ error: "Not connected to Figma" }, { status: 401 })

  let body: { url?: string; action?: string; nodeId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = parseFigmaUrl(body.url ?? "")
  if (!parsed) return NextResponse.json({ error: "Invalid Figma URL" }, { status: 400 })
  const { key, nodeId: urlNodeId } = parsed
  const nodeId = body.nodeId ?? urlNodeId

  function figmaErrResponse(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const isAuth = msg.includes("401") || msg.includes("403")
    const res = NextResponse.json({ error: msg }, { status: isAuth ? 401 : 500 })
    if (isAuth) res.cookies.delete("figma_token")
    return res
  }

  // ── List frames ──────────────────────────────────────────────────────
  if (body.action === "frames") {
    try {
      const result = await listFrames(token, key)
      return NextResponse.json(result)
    } catch (e) {
      return figmaErrResponse(e)
    }
  }

  // ── Import layout ─────────────────────────────────────────────────────
  try {
    const { root } = await fetchDocument(token, key, nodeId)
    const [imageFills, vectorIds] = await Promise.all([
      getImageFills(token, key),
      Promise.resolve(collectVectorIds(root)),
    ])
    const svgExports = await getSvgExports(token, key, vectorIds)
    const layout = nodeToLayout(root, imageFills, svgExports)
    return NextResponse.json({ layout })
  } catch (e) {
    return figmaErrResponse(e)
  }
}
