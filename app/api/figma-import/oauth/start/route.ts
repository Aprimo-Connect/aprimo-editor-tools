import { NextRequest, NextResponse } from "next/server"
import { buildAuthorizeUrl, DEFAULT_FIGMA_SCOPE } from "@/lib/figma-api"
import { randomBytes } from "crypto"

export async function GET(req: NextRequest) {
  const clientId = process.env.FIGMA_CLIENT_ID
  if (!clientId) {
    return new NextResponse("FIGMA_CLIENT_ID is not configured", { status: 500 })
  }

  const origin = req.nextUrl.origin
  const redirectUri = process.env.FIGMA_OAUTH_REDIRECT ?? `${origin}/api/figma-import/oauth/callback`
  const scope = process.env.FIGMA_SCOPE ?? DEFAULT_FIGMA_SCOPE
  const state = randomBytes(16).toString("hex")

  const url = buildAuthorizeUrl(clientId, redirectUri, state, scope)

  const res = NextResponse.redirect(url)
  // Store state in a short-lived cookie for CSRF validation in the callback.
  res.cookies.set("figma_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  })
  return res
}
