import { NextRequest, NextResponse } from "next/server"

// GET /api/elevenlabs/dub/{id}/video?lang=es
// Proxies the dubbed video stream from ElevenLabs back to the browser.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY is not configured" }, { status: 500 })
  }

  const { id } = await params
  const lang = req.nextUrl.searchParams.get("lang") ?? "es"

  const res = await fetch(`https://api.elevenlabs.io/v1/dubbing/${id}/audio/${lang}`, {
    headers: { "xi-api-key": apiKey },
  })

  if (!res.ok) {
    const body = await res.text()
    return NextResponse.json({ error: body || "Failed to download dubbed video" }, { status: res.status })
  }

  return new NextResponse(res.body, {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "video/mp4",
      "Content-Disposition": `attachment; filename="dubbed-${lang}.mp4"`,
    },
  })
}
