import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { exchangeCodeForToken } from "@/lib/figma-api"

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  if (error) {
    return NextResponse.redirect(`${origin}/creative-template-create?figma_error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/creative-template-create?figma_error=missing_code`)
  }

  const jar = await cookies()

  // CSRF check
  const storedState = jar.get("figma_oauth_state")?.value
  if (storedState && storedState !== state) {
    return NextResponse.redirect(`${origin}/creative-template-create?figma_error=state_mismatch`)
  }

  const clientId = process.env.FIGMA_CLIENT_ID || jar.get("figma_client_id")?.value || ""
  const clientSecret = process.env.FIGMA_CLIENT_SECRET || jar.get("figma_client_secret")?.value || ""
  if (!clientId || !clientSecret) {
    return new NextResponse("Figma OAuth is not configured", { status: 500 })
  }

  const redirectUri =
    process.env.FIGMA_OAUTH_REDIRECT ||
    jar.get("figma_oauth_redirect")?.value ||
    `${origin}/api/figma-import/oauth/callback`

  try {
    const token = await exchangeCodeForToken({ clientId, clientSecret, redirectUri, code })

    const res = NextResponse.redirect(`${origin}/creative-template-create?figma_connected=1`)
    res.cookies.set("figma_token", token.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: token.expires_in ?? 60 * 60 * 24 * 90,
      path: "/",
    })
    res.cookies.delete("figma_oauth_state")
    res.cookies.delete("figma_client_id")
    res.cookies.delete("figma_client_secret")
    res.cookies.delete("figma_oauth_redirect")
    return res
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.redirect(`${origin}/creative-template-create?figma_error=${encodeURIComponent(msg)}`)
  }
}
