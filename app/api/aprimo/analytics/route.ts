import { NextRequest, NextResponse } from "next/server"

// Server-side proxy for the Aprimo Analytics API.
// The analytics endpoint does not send CORS headers for browser requests,
// so this route forwards the query server-side.
//
// POST body: { environment: string, authHeader: string, query: object }
//   authHeader — the full Authorization header value (e.g. "Bearer <token>")
// Returns: the raw JSON response from the analytics API
export async function POST(req: NextRequest) {
  try {
    const { environment, authHeader, query } = await req.json()

    if (!environment || !authHeader || !query) {
      return NextResponse.json({ error: "Missing environment, authHeader, or query" }, { status: 400 })
    }

    const url = `https://${environment}.aprimo.com/analytics/?query=${encodeURIComponent(JSON.stringify(query))}`
    const res = await fetch(url, {
      headers: { Authorization: authHeader },
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json(
        { error: `Analytics API error ${res.status}: ${text}` },
        { status: res.status },
      )
    }

    const json = await res.json()
    return NextResponse.json(json)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 },
    )
  }
}
