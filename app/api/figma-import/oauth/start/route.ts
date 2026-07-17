import { NextRequest, NextResponse } from "next/server"
import { buildAuthorizeUrl, DEFAULT_FIGMA_SCOPE } from "@/lib/figma-api"
import { randomBytes } from "crypto"

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl

  const clientId = process.env.FIGMA_CLIENT_ID || searchParams.get("figma_client_id") || ""
  if (!clientId) {
    return new NextResponse("FIGMA_CLIENT_ID is not configured", { status: 500 })
  }

  const redirectUri =
    process.env.FIGMA_OAUTH_REDIRECT ||
    searchParams.get("figma_oauth_redirect") ||
    `${origin}/api/figma-import/oauth/callback`

  const scope = process.env.FIGMA_SCOPE ?? DEFAULT_FIGMA_SCOPE
  const state = randomBytes(16).toString("hex")

  const url = buildAuthorizeUrl(clientId, redirectUri, state, scope)

  const res = NextResponse.redirect(url)
  res.cookies.set("figma_oauth_state", state, {
    httpOnly: true, sameSite: "lax", maxAge: 600, path: "/",
  })

  // If credentials came from the client (not env), store them for the callback.
  if (!process.env.FIGMA_CLIENT_ID && searchParams.get("figma_client_id")) {
    const clientSecret = searchParams.get("figma_client_secret") ?? ""
    res.cookies.set("figma_client_id", clientId, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" })
    res.cookies.set("figma_client_secret", clientSecret, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" })
    res.cookies.set("figma_oauth_redirect", redirectUri, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" })
  }

  return res
}
