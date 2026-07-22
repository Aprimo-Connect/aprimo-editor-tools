import { NextRequest, NextResponse } from "next/server"

// POST /api/elevenlabs/dub
// Body: { videoUrl: string, targetLang: string, sourceLang?: string }
// Returns: { dubbingId: string, expectedDurationSec?: number }
//
// Passes videoUrl directly to ElevenLabs so the file never transits this server.
export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY is not configured" }, { status: 500 })
  }

  const { videoUrl, targetLang, sourceLang } = await req.json()
  if (!videoUrl || !targetLang) {
    return NextResponse.json({ error: "videoUrl and targetLang are required" }, { status: 400 })
  }

  const form = new FormData()
  form.append("source_url", videoUrl)
  form.append("target_lang", targetLang)
  if (sourceLang) form.append("source_lang", sourceLang)
  form.append("watermark", "false")
  form.append("highest_resolution", "true")

  const res = await fetch("https://api.elevenlabs.io/v1/dubbing", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  })

  if (!res.ok) {
    const body = await res.text()
    return NextResponse.json({ error: body || "ElevenLabs dubbing request failed" }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json({
    dubbingId: data.dubbing_id,
    expectedDurationSec: data.expected_duration_sec ?? null,
  })
}
