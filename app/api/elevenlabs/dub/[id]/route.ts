import { NextRequest, NextResponse } from "next/server"

// GET /api/elevenlabs/dub/{id}
// Returns the ElevenLabs dubbing job status object.
// Relevant fields: status ("dubbing" | "dubbed" | "failed"), error
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY is not configured" }, { status: 500 })
  }

  const { id } = await params

  const res = await fetch(`https://api.elevenlabs.io/v1/dubbing/${id}`, {
    headers: { "xi-api-key": apiKey },
  })

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to get dubbing status" }, { status: res.status })
  }

  return NextResponse.json(await res.json())
}
