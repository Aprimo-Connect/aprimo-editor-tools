"use client"

import { useEffect, useRef, useState } from "react"
import { Film, ImageIcon, Layers, Minus, Music2, Plus, Scissors, Type, Volume2, VolumeX, X } from "lucide-react"
import { toast } from "sonner"
import {
  VideoClip, TransitionClip, AudioClip, TextClip, SelectedAsset,
  PIXELS_PER_SECOND, DEFAULT_CLIP_DURATION,
} from "../types"

const TRACKS = [
  { label: "Text",        icon: Type,   color: "text-orange-500", bg: "bg-orange-500/10" },
  { label: "Transitions", icon: Layers, color: "text-purple-500", bg: "bg-purple-500/10" },
  { label: "Video",       icon: Film,   color: "text-blue-500",   bg: "bg-blue-500/10"   },
  { label: "Audio",       icon: Music2, color: "text-green-500",  bg: "bg-green-500/10"  },
] as const

const ZOOM_STEPS = [5, 10, 20, 30, 50, 60, 80, 100, 120, 150, 200, 300]

function niceRulerStep(pps: number): number {
  // Target ~100px between marks
  const rawSecs = 100 / pps
  const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  return steps.find((s) => s >= rawSecs) ?? steps[steps.length - 1]
}

interface VideoTimelineProps {
  sortedClips: VideoClip[]
  setVideoClips: React.Dispatch<React.SetStateAction<VideoClip[]>>
  transitionClips: TransitionClip[]
  setTransitionClips: React.Dispatch<React.SetStateAction<TransitionClip[]>>
  audioClips: AudioClip[]
  setAudioClips: React.Dispatch<React.SetStateAction<AudioClip[]>>
  textClips: TextClip[]
  setTextClips: React.Dispatch<React.SetStateAction<TextClip[]>>
  assets: SelectedAsset[]
  durations: Record<string, number>
  trimClipId: string | null
  setTrimClipId: (id: string | null) => void
  draggingId: string | null
  setDraggingId: (id: string | null) => void
  draggingTransitionType: string | null
  setDraggingTransitionType: (t: string | null) => void
  videoEndTime: number
  disableFades: boolean
}

export function VideoTimeline({
  sortedClips,
  setVideoClips,
  transitionClips,
  setTransitionClips,
  audioClips,
  setAudioClips,
  textClips,
  setTextClips,
  assets,
  durations,
  trimClipId,
  setTrimClipId,
  draggingId,
  setDraggingId,
  draggingTransitionType,
  setDraggingTransitionType,
  videoEndTime,
  disableFades,
}: VideoTimelineProps) {
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const [pps, setPps] = useState(PIXELS_PER_SECOND) // pixels per second — zoom level
  const ppsRef = useRef(pps)
  ppsRef.current = pps

  const [dropTarget, setDropTarget] = useState(false)
  const [transitionDropTarget, setTransitionDropTarget] = useState(false)
  const [audioDropTarget, setAudioDropTarget] = useState(false)
  const [textDropTarget, setTextDropTarget] = useState(false)
  const [draggingClip, setDraggingClip] = useState<{ assetId: string; grabOffsetPx: number } | null>(null)
  const [draggingTransitionClip, setDraggingTransitionClip] = useState<{ id: string; grabOffsetPx: number } | null>(null)
  const [draggingAudioClip, setDraggingAudioClip] = useState<{ id: string; grabOffsetPx: number } | null>(null)
  const [draggingTextClip, setDraggingTextClip] = useState<{ id: string; grabOffsetPx: number } | null>(null)
  const [resizingTransition, setResizingTransition] = useState<{ id: string; startX: number; startDuration: number } | null>(null)
  const [resizingAudioClip, setResizingAudioClip] = useState<{ id: string; edge: "left" | "right"; startX: number; startTrimIn: number; startDuration: number; startTime: number } | null>(null)
  const [resizingVideoClip, setResizingVideoClip] = useState<{ assetId: string; startX: number; startDuration: number } | null>(null)
  const [resizingTextClip, setResizingTextClip] = useState<{ id: string; edge: "left" | "right"; startX: number; startDuration: number; startTime: number } | null>(null)

  function zoomIn() {
    setPps((p) => ZOOM_STEPS.find((z) => z > p) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1])
  }
  function zoomOut() {
    setPps((p) => [...ZOOM_STEPS].reverse().find((z) => z < p) ?? ZOOM_STEPS[0])
  }
  function fitToContent() {
    const containerW = timelineScrollRef.current?.clientWidth ?? 800
    const raw = containerW / Math.max(1, totalDuration)
    const clamped = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], raw))
    setPps(clamped)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (sortedClips.length > 0) fitToContent() }, [sortedClips.length])

  useEffect(() => {
    if (!resizingTransition) return
    function onMouseMove(e: MouseEvent) {
      const delta = (e.clientX - resizingTransition!.startX) / ppsRef.current
      setTransitionClips((prev) => prev.map((tc) =>
        tc.id === resizingTransition!.id ? { ...tc, duration: Math.min(1.5, Math.max(0.25, resizingTransition!.startDuration + delta)) } : tc
      ))
    }
    function onMouseUp() { setResizingTransition(null) }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp) }
  }, [resizingTransition])

  useEffect(() => {
    if (!resizingVideoClip) return
    function onMouseMove(e: MouseEvent) {
      const delta = (e.clientX - resizingVideoClip!.startX) / ppsRef.current
      setVideoClips((prev) => prev.map((c) =>
        c.assetId === resizingVideoClip!.assetId ? { ...c, duration: Math.max(0.5, resizingVideoClip!.startDuration + delta), trimSet: true } : c
      ))
    }
    function onMouseUp() { setResizingVideoClip(null) }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp) }
  }, [resizingVideoClip])

  useEffect(() => {
    if (!resizingAudioClip) return
    function onMouseMove(e: MouseEvent) {
      const delta = (e.clientX - resizingAudioClip!.startX) / ppsRef.current
      setAudioClips((prev) => prev.map((c) => {
        if (c.id !== resizingAudioClip!.id) return c
        if (resizingAudioClip!.edge === "right") {
          return { ...c, duration: Math.max(0.5, Math.min(resizingAudioClip!.startDuration + delta, c.sourceDuration - c.trimIn)) }
        }
        const rawTrimIn = resizingAudioClip!.startTrimIn + delta
        const newTrimIn = Math.max(0, Math.min(rawTrimIn, c.sourceDuration - 0.5))
        const actualDelta = newTrimIn - resizingAudioClip!.startTrimIn
        return {
          ...c,
          trimIn: newTrimIn,
          duration: Math.max(0.5, resizingAudioClip!.startDuration - actualDelta),
          startTime: Math.max(0, resizingAudioClip!.startTime + actualDelta),
        }
      }))
    }
    function onMouseUp() { setResizingAudioClip(null) }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp) }
  }, [resizingAudioClip])

  useEffect(() => {
    if (!resizingTextClip) return
    function onMouseMove(e: MouseEvent) {
      const delta = (e.clientX - resizingTextClip!.startX) / ppsRef.current
      setTextClips((prev) => prev.map((c) => {
        if (c.id !== resizingTextClip!.id) return c
        if (resizingTextClip!.edge === "right") {
          return { ...c, duration: Math.max(0.5, resizingTextClip!.startDuration + delta) }
        }
        const newStart = Math.max(0, resizingTextClip!.startTime + delta)
        const actualDelta = newStart - resizingTextClip!.startTime
        return { ...c, startTime: newStart, duration: Math.max(0.5, resizingTextClip!.startDuration - actualDelta) }
      }))
    }
    function onMouseUp() { setResizingTextClip(null) }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp) }
  }, [resizingTextClip])

  function probeAudioDuration(id: string, url: string) {
    const audio = document.createElement("audio")
    audio.preload = "metadata"
    audio.src = url
    audio.onloadedmetadata = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setAudioClips((prev) => prev.map((c) => c.id === id ? { ...c, duration: audio.duration, sourceDuration: audio.duration } : c))
      }
      audio.src = ""
    }
    audio.onerror = () => { audio.src = "" }
  }

  function snapStart(raw: number, excludeId?: string): number {
    const others = sortedClips.filter((c) => c.assetId !== excludeId)
    if (others.length === 0) return 0
    const SNAP = 1.0
    const candidates = [0, ...others.flatMap((c) => [c.startTime, c.startTime + c.duration])]
    let best = raw; let bestDist = SNAP
    for (const c of candidates) { const d = Math.abs(raw - c); if (d < bestDist) { best = c; bestDist = d } }
    return bestDist < SNAP ? best : Math.round(raw * 2) / 2
  }

  function snapAudioStart(raw: number, excludeId?: string): number {
    const others = audioClips.filter((c) => c.id !== excludeId)
    if (others.length === 0) return 0
    const SNAP = 1.0
    const candidates = [0, ...others.flatMap((c) => [c.startTime, c.startTime + c.duration])]
    let best = raw; let bestDist = SNAP
    for (const c of candidates) { const d = Math.abs(raw - c); if (d < bestDist) { best = c; bestDist = d } }
    return bestDist < SNAP ? best : Math.round(raw * 2) / 2
  }

  function snapTextStart(raw: number): number {
    return Math.max(0, Math.round(raw * 20) / 20)
  }

  function handleTextDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setTextDropTarget(false)
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left + (timelineScrollRef.current?.scrollLeft ?? 0)
    if (draggingTextClip) {
      setTextClips((prev) => prev.map((c) =>
        c.id === draggingTextClip.id
          ? { ...c, startTime: snapTextStart(Math.max(0, (x - draggingTextClip.grabOffsetPx) / ppsRef.current)) }
          : c
      ))
      setDraggingTextClip(null)
      return
    }
    if (draggingId) {
      const asset = assets.find((a) => a.id === draggingId)
      if (asset?.mediaType !== "text") {
        toast.error("Only text assets can be added to the Text track")
        setDraggingId(null)
        return
      }
      setTextClips((prev) => [...prev, {
        id: crypto.randomUUID(),
        assetId: draggingId!,
        startTime: snapTextStart(Math.max(0, x / ppsRef.current)),
        duration: DEFAULT_CLIP_DURATION,
      }])
      setDraggingId(null)
    }
  }

  function handleVideoDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDropTarget(false)
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left + (timelineScrollRef.current?.scrollLeft ?? 0)
    if (draggingClip) {
      setVideoClips((prev) => prev.map((c) =>
        c.assetId === draggingClip.assetId
          ? { ...c, startTime: snapStart(Math.max(0, (x - draggingClip.grabOffsetPx) / ppsRef.current), draggingClip.assetId) }
          : c
      ))
      setDraggingClip(null)
    } else if (draggingId) {
      const draggedType = assets.find((a) => a.id === draggingId)?.mediaType
      if (draggedType === "audio") {
        toast.error("Audio assets can only be added to the Audio track")
        setDraggingId(null)
        return
      }
      if (draggedType === "text") {
        toast.error("Text assets can only be added to the Text track")
        setDraggingId(null)
        return
      }
      if (!sortedClips.some((c) => c.assetId === draggingId)) {
        setVideoClips((prev) => [...prev, {
          assetId: draggingId!,
          startTime: snapStart(Math.max(0, x / ppsRef.current)),
          duration: durations[draggingId!] ?? DEFAULT_CLIP_DURATION,
          trimIn: 0, trimSet: false, muted: false,
        }])
      }
      setDraggingId(null)
    }
  }

  function handleTransitionDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setTransitionDropTarget(false)
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left + (timelineScrollRef.current?.scrollLeft ?? 0)
    if (draggingTransitionClip) {
      const newStart = Math.max(0, Math.round((x - draggingTransitionClip.grabOffsetPx) / ppsRef.current * 2) / 2)
      setTransitionClips((prev) => prev.map((c) => c.id === draggingTransitionClip.id ? { ...c, startTime: newStart } : c))
      setDraggingTransitionClip(null)
    } else if (draggingTransitionType) {
      setTransitionClips((prev) => [...prev, {
        id: `${draggingTransitionType}-${Date.now()}`,
        type: draggingTransitionType,
        startTime: Math.max(0, Math.round(x / ppsRef.current * 2) / 2),
        duration: 1,
      }])
      setDraggingTransitionType(null)
    }
  }

  function onAudioLaneDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setAudioDropTarget(false)
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left + (timelineScrollRef.current?.scrollLeft ?? 0)
    if (draggingAudioClip) {
      setAudioClips((prev) => prev.map((c) =>
        c.id === draggingAudioClip.id
          ? { ...c, startTime: snapAudioStart(Math.max(0, (x - draggingAudioClip.grabOffsetPx) / ppsRef.current), draggingAudioClip.id) }
          : c
      ))
      setDraggingAudioClip(null)
      return
    }
    if (draggingId) {
      const asset = assets.find((a) => a.id === draggingId)
      if (!asset?.publicLink) { setDraggingId(null); return }
      if (asset.mediaType !== "audio") {
        toast.error("Only audio assets can be added to the Audio track")
        setDraggingId(null)
        return
      }
      const id = crypto.randomUUID()
      setAudioClips((prev) => [...prev, {
        id, url: asset.publicLink!, name: asset.title,
        startTime: snapAudioStart(Math.max(0, x / ppsRef.current)),
        trimIn: 0, duration: DEFAULT_CLIP_DURATION, sourceDuration: DEFAULT_CLIP_DURATION,
      }])
      probeAudioDuration(id, asset.publicLink)
      setDraggingId(null)
    }
  }

  const safeDur = (c: { assetId: string; duration: number }) =>
    isFinite(c.duration) && c.duration > 0 ? c.duration : DEFAULT_CLIP_DURATION

  const totalDuration = Math.max(
    30,
    ...sortedClips.map((c) => c.startTime + safeDur(c)),
    ...transitionClips.map((c) => c.startTime + c.duration),
    ...audioClips.map((c) => c.startTime + c.duration),
    ...textClips.map((c) => c.startTime + c.duration),
  )
  const totalWidth = totalDuration * pps
  const rulerStep = niceRulerStep(pps)
  const marks = Array.from({ length: Math.ceil(totalDuration / rulerStep) + 1 }, (_, i) => i * rulerStep)

  const iconBtn = "h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"

  return (
    <div className="shrink-0 border-t border-border bg-card select-none">
      <div className="flex">
        {/* Fixed label column */}
        <div className="w-32 shrink-0 border-r border-border">
          <div className="h-6 border-b border-border flex items-center px-2 gap-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide mr-auto" style={{ fontSize: 9 }}>Timeline</span>
            <button className={iconBtn} onClick={zoomOut} title="Zoom out"><Minus className="h-3 w-3" /></button>
            <button className={iconBtn} onClick={fitToContent} title="Fit to content" style={{ fontSize: 9, width: "auto", paddingInline: 2 }}>Fit</button>
            <button className={iconBtn} onClick={zoomIn} title="Zoom in"><Plus className="h-3 w-3" /></button>
          </div>
          {TRACKS.filter((t) => !(disableFades && t.label === "Transitions")).map(({ label, icon: Icon, color }) => (
            <div key={label} className="h-12 flex items-center gap-2 px-3 border-b border-border last:border-0">
              <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
              <span className={`text-xs font-medium ${color}`}>{label}</span>
            </div>
          ))}
        </div>

        {/* Scrollable lanes */}
        <div ref={timelineScrollRef} className="flex-1 overflow-x-auto">
          <div style={{ width: totalWidth }}>
            {/* Time ruler */}
            <div className="h-6 border-b border-border relative">
              {marks.map((t) => (
                <div key={t} className="absolute top-0 flex flex-col" style={{ left: t * pps }}>
                  <div className="w-px h-2 bg-border" />
                  <span className="text-muted-foreground pl-1" style={{ fontSize: 9 }}>
                    {rulerStep < 1 ? `${t}s` : t >= 60 ? `${Math.floor(t / 60)}m${t % 60 ? `${t % 60}s` : ""}` : `${t}s`}
                  </span>
                </div>
              ))}
            </div>

            {/* Track lanes */}
            {TRACKS.filter((t) => !(disableFades && t.label === "Transitions")).map(({ label }) => (
              <div
                key={label}
                className={`h-12 border-b border-border last:border-0 relative transition-colors ${label === "Video" && dropTarget ? "bg-blue-500/10" : ""} ${label === "Transitions" && transitionDropTarget ? "bg-purple-500/10" : ""} ${label === "Audio" && audioDropTarget ? "bg-green-500/10" : ""} ${label === "Text" && textDropTarget ? "bg-orange-500/10" : ""}`}
                onDragOver={
                  label === "Video" ? (e) => { e.preventDefault(); setDropTarget(true) }
                  : label === "Transitions" ? (e) => { e.preventDefault(); setTransitionDropTarget(true) }
                  : label === "Audio" ? (e) => { e.preventDefault(); setAudioDropTarget(true) }
                  : label === "Text" ? (e) => { e.preventDefault(); setTextDropTarget(true) }
                  : undefined
                }
                onDragLeave={
                  label === "Video" ? () => setDropTarget(false)
                  : label === "Transitions" ? () => setTransitionDropTarget(false)
                  : label === "Audio" ? () => setAudioDropTarget(false)
                  : label === "Text" ? () => setTextDropTarget(false)
                  : undefined
                }
                onDrop={
                  label === "Video" ? handleVideoDrop
                  : label === "Transitions" ? handleTransitionDrop
                  : label === "Audio" ? onAudioLaneDrop
                  : label === "Text" ? handleTextDrop
                  : undefined
                }
              >
                {label === "Video" && sortedClips.length === 0 && (
                  <span className="absolute inset-0 flex items-center px-3 text-xs text-muted-foreground opacity-40">Drop videos or images here</span>
                )}
                {label === "Text" && textClips.length === 0 && (
                  <span className="absolute inset-0 flex items-center px-3 text-xs text-muted-foreground opacity-40">Drag text assets here</span>
                )}
                {label === "Transitions" && transitionClips.length === 0 && (
                  <span className="absolute inset-0 flex items-center px-3 text-xs text-muted-foreground opacity-40">Drop transitions here</span>
                )}
                {label === "Audio" && audioClips.length === 0 && (
                  <span className="absolute inset-0 flex items-center px-3 text-xs text-muted-foreground opacity-40">Drag audio assets here</span>
                )}

                {label === "Text" && textClips.map((tc) => {
                  const asset = assets.find((a) => a.id === tc.assetId)
                  const isMoving = draggingTextClip?.id === tc.id
                  return (
                    <div
                      key={tc.id}
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); setDraggingTextClip({ id: tc.id, grabOffsetPx: e.clientX - e.currentTarget.getBoundingClientRect().left }) }}
                      onDragEnd={() => setDraggingTextClip(null)}
                      className={`absolute top-1.5 bottom-1.5 rounded flex items-center gap-1 px-2 overflow-hidden cursor-grab active:cursor-grabbing transition-opacity border border-orange-500/40 bg-orange-500/20 ${isMoving ? "opacity-40" : ""}`}
                      style={{ left: tc.startTime * pps, width: tc.duration * pps }}
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-orange-500/50 rounded-l z-10"
                        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setResizingTextClip({ id: tc.id, edge: "left", startX: e.clientX, startDuration: tc.duration, startTime: tc.startTime }) }} />
                      <Type className="h-3 w-3 shrink-0 text-orange-500" />
                      <span className="text-xs text-orange-700 dark:text-orange-400 truncate">{asset?.title ?? tc.assetId}</span>
                      <button onClick={(e) => { e.stopPropagation(); setTextClips((prev) => prev.filter((c) => c.id !== tc.id)) }} className="shrink-0 opacity-60 hover:opacity-100 ml-auto"><X className="h-2.5 w-2.5" /></button>
                      <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-orange-500/50 rounded-r z-10"
                        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setResizingTextClip({ id: tc.id, edge: "right", startX: e.clientX, startDuration: tc.duration, startTime: tc.startTime }) }} />
                    </div>
                  )
                })}

                {label === "Transitions" && transitionClips.map((tc) => (
                  <div
                    key={tc.id}
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); setDraggingTransitionClip({ id: tc.id, grabOffsetPx: e.clientX - e.currentTarget.getBoundingClientRect().left }) }}
                    onDragEnd={() => setDraggingTransitionClip(null)}
                    className={`absolute top-1.5 bottom-1.5 rounded flex items-center gap-1 px-2 overflow-hidden cursor-grab active:cursor-grabbing border border-purple-500/40 bg-purple-500/20 transition-opacity ${draggingTransitionClip?.id === tc.id ? "opacity-40" : ""}`}
                    style={{ left: tc.startTime * pps, width: tc.duration * pps }}
                  >
                    <Layers className="h-3 w-3 shrink-0 text-purple-500" />
                    <span className="text-xs text-purple-600 dark:text-purple-400 truncate">{tc.type}</span>
                    <button onClick={(e) => { e.stopPropagation(); setTransitionClips((prev) => prev.filter((c) => c.id !== tc.id)) }} className="shrink-0 opacity-60 hover:opacity-100 ml-auto"><X className="h-2.5 w-2.5" /></button>
                    <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-purple-500/50 rounded-r" onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setResizingTransition({ id: tc.id, startX: e.clientX, startDuration: tc.duration }) }} />
                  </div>
                ))}

                {label === "Video" && sortedClips.map((clip) => {
                  const asset = assets.find((a) => a.id === clip.assetId)
                  const isImg = asset?.mediaType === "image"
                  const isMoving = draggingClip?.assetId === clip.assetId
                  const isTrimming = trimClipId === clip.assetId
                  return (
                    <div
                      key={clip.assetId}
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); setDraggingClip({ assetId: clip.assetId, grabOffsetPx: e.clientX - e.currentTarget.getBoundingClientRect().left }) }}
                      onDragEnd={() => setDraggingClip(null)}
                      className={`absolute top-1.5 bottom-1.5 rounded flex items-center gap-1 px-2 overflow-hidden cursor-grab active:cursor-grabbing transition-opacity ${isMoving ? "opacity-40" : ""} ${isTrimming ? "bg-amber-500/40 border-2 border-amber-500" : "bg-blue-500/20 border border-blue-500/40"}`}
                      style={{ left: clip.startTime * pps, width: safeDur(clip) * pps }}
                    >
                      {isImg ? <ImageIcon className="h-3 w-3 shrink-0 text-blue-500" /> : <Film className="h-3 w-3 shrink-0 text-blue-500" />}
                      <span className="text-xs text-blue-600 dark:text-blue-400 truncate">{asset?.title ?? clip.assetId}</span>
                      {!isImg && (
                        <button onClick={(e) => { e.stopPropagation(); setTrimClipId(isTrimming ? null : clip.assetId) }}
                          className={`shrink-0 ml-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${isTrimming ? "bg-amber-500 text-white" : "bg-blue-200 hover:bg-blue-300 text-blue-800"}`} title="Edit trim">
                          <Scissors className="h-3 w-3" /><span>Trim</span>
                        </button>
                      )}
                      {!isImg && (
                        <button onClick={(e) => { e.stopPropagation(); setVideoClips((prev) => prev.map((c) => c.assetId === clip.assetId ? { ...c, muted: !c.muted } : c)) }}
                          className={`shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${clip.muted ? "bg-red-200 hover:bg-red-300 text-red-800" : "bg-blue-200 hover:bg-blue-300 text-blue-800"}`}
                          title={clip.muted ? "Unmute" : "Mute"}>
                          {clip.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); setVideoClips((prev) => prev.filter((c) => c.assetId !== clip.assetId)); if (isTrimming) setTrimClipId(null) }} className="shrink-0 opacity-60 hover:opacity-100"><X className="h-2.5 w-2.5" /></button>
                      {isImg && (
                        <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-500/50 rounded-r z-10"
                          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setResizingVideoClip({ assetId: clip.assetId, startX: e.clientX, startDuration: clip.duration }) }} />
                      )}
                    </div>
                  )
                })}

                {label === "Audio" && audioClips.map((ac) => (
                  <div
                    key={ac.id}
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); setDraggingAudioClip({ id: ac.id, grabOffsetPx: e.clientX - e.currentTarget.getBoundingClientRect().left }) }}
                    onDragEnd={() => setDraggingAudioClip(null)}
                    className={`absolute top-1.5 bottom-1.5 rounded flex items-center gap-1 px-2 overflow-hidden cursor-grab active:cursor-grabbing border border-green-500/40 bg-green-500/20 transition-opacity ${draggingAudioClip?.id === ac.id ? "opacity-40" : ""}`}
                    style={{ left: ac.startTime * pps, width: ac.duration * pps }}
                    onMouseDown={(e) => { if (resizingAudioClip) e.preventDefault() }}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-green-500/50 rounded-l z-10"
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setResizingAudioClip({ id: ac.id, edge: "left", startX: e.clientX, startTrimIn: ac.trimIn, startDuration: ac.duration, startTime: ac.startTime }) }} />
                    <Music2 className="h-3 w-3 shrink-0 text-green-600 ml-1" />
                    <span className="text-xs text-green-700 dark:text-green-400 truncate">{ac.name}</span>
                    {videoEndTime > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); const avail = videoEndTime - ac.startTime; if (avail <= 0) return; setAudioClips((prev) => prev.map((c) => c.id === ac.id ? { ...c, duration: Math.max(0.1, Math.min(ac.duration, avail, ac.sourceDuration - ac.trimIn)) } : c)) }}
                        className="shrink-0 ml-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium transition-colors bg-green-200 hover:bg-green-300 text-green-800" title="Crop to video length">
                        <Scissors className="h-3 w-3" /><span>Fit</span>
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); setAudioClips((prev) => prev.filter((c) => c.id !== ac.id)) }} className="shrink-0 opacity-60 hover:opacity-100"><X className="h-2.5 w-2.5" /></button>
                    <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-green-500/50 rounded-r z-10"
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setResizingAudioClip({ id: ac.id, edge: "right", startX: e.clientX, startTrimIn: ac.trimIn, startDuration: ac.duration, startTime: ac.startTime }) }} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
