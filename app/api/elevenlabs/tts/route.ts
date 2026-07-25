import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 })

  const { text, voiceId } = await req.json()
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 })

  const voice = voiceId ?? process.env.ELEVENLABS_TTS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM"

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    return NextResponse.json({ error: body || "ElevenLabs TTS failed" }, { status: res.status })
  }

  return new NextResponse(res.body, { headers: { "Content-Type": "audio/mpeg" } })
}
