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

// GET — connection check
export async function GET() {
  const token = await getToken()
  return NextResponse.json({ connected: !!token })
}

// POST — list frames (action:"frames") or import a layout
export async function POST(req: NextRequest) {
  const token = await getToken()
  if (!token) return NextResponse.json({ error: "Not connected to Figma" }, { status: 401 })

  let body: { url?: string; action?: string; nodeId?: string; nodeIds?: string[] }
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

  // ── Extract image fills from within frames ────────────────────────────
  if (body.action === "extract-images") {
    try {
      // Full document tree (no depth cap) + image fill URLs in parallel
      const [docRes, fillsRes] = await Promise.all([
        fetch(`https://api.figma.com/v1/files/${key}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`https://api.figma.com/v1/files/${key}/images`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (!docRes.ok) throw new Error(`Figma file fetch failed (${docRes.status}): ${await docRes.text()}`)
      const [doc, fillsData] = await Promise.all([docRes.json(), fillsRes.ok ? fillsRes.json() : {}])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fills: Record<string, string> = (fillsData as any)?.meta?.images ?? {}

      // Walk a node subtree and collect nodes that have an IMAGE fill.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function walkImages(node: any): { nodeId: string; name: string; url: string }[] {
        if (!node) return []
        const imgFill = Array.isArray(node.fills)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? node.fills.find((f: any) => f.type === "IMAGE" && f.imageRef && fills[f.imageRef])
          : null
        if (imgFill) {
          // This node is itself an image — don't descend further
          return [{ nodeId: node.id, name: node.name ?? "Image", url: fills[imgFill.imageRef] }]
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (node.children ?? []).flatMap((c: any) => walkImages(c))
      }

      const FRAME_TYPES = new Set(["FRAME", "COMPONENT", "COMPONENT_SET", "SECTION", "INSTANCE"])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pages = (doc?.document?.children ?? []).filter((p: any) => p?.type === "CANVAS").map((page: any) => ({
        id: page.id,
        name: page.name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        frames: (page.children ?? []).filter((c: any) => FRAME_TYPES.has(c.type)).map((frame: any) => ({
          id: frame.id,
          name: frame.name,
          images: walkImages(frame),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        })).filter((f: any) => f.images.length > 0),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })).filter((p: any) => p.frames.length > 0)

      return NextResponse.json({ name: doc?.name ?? "Figma file", pages })
    } catch (e) {
      return figmaErrResponse(e)
    }
  }

  // ── Render frames to PNG URLs ─────────────────────────────────────────
  if (body.action === "render") {
    const nodeIds: string[] = Array.isArray(body.nodeIds) ? body.nodeIds : []
    if (!nodeIds.length) return NextResponse.json({ images: {} })
    try {
      const params = new URLSearchParams({ ids: nodeIds.join(","), format: "png", scale: "1" })
      const res = await fetch(`https://api.figma.com/v1/images/${key}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Figma image render failed (${res.status}): ${await res.text()}`)
      const data = await res.json()
      return NextResponse.json({ images: data?.images ?? {} })
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
