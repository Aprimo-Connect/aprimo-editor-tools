import { NextRequest, NextResponse } from "next/server"
import { buildAuthorizeUrl, DEFAULT_FIGMA_SCOPE } from "@/lib/figma-api"
import { randomBytes } from "crypto"

export async function GET(req: NextRequest) {
  const clientId = process.env.FIGMA_CLIENT_ID ?? ""
  if (!clientId) {
    return new NextResponse("FIGMA_CLIENT_ID is not configured", { status: 500 })
  }

  const { origin, searchParams } = req.nextUrl
  const returnTo = searchParams.get("returnTo") ?? ""
  const redirectUri = process.env.FIGMA_OAUTH_REDIRECT ?? `${origin}/api/figma-import/oauth/callback`
  const scope = process.env.FIGMA_SCOPE ?? DEFAULT_FIGMA_SCOPE
  const state = randomBytes(16).toString("hex")

  const url = buildAuthorizeUrl(clientId, redirectUri, state, scope)

  const res = NextResponse.redirect(url)
  res.cookies.set("figma_oauth_state", state, {
    httpOnly: true, sameSite: "lax", maxAge: 600, path: "/",
  })
  if (returnTo) {
    res.cookies.set("figma_oauth_returnTo", returnTo, {
      httpOnly: true, sameSite: "lax", maxAge: 600, path: "/",
    })
  }

  return res
}
