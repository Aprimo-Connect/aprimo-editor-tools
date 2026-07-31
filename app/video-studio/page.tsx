"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { useAprimo } from "@/context/aprimo-context"
import { VideoSettingsPanel } from "../video-resizer/components/video-settings-panel"
import { StudioSidebar } from "./components/studio-sidebar"
import { VideoTimeline } from "./components/video-timeline"
import { StudioDialogs } from "./components/studio-dialogs"
import { StudioPreview } from "./components/studio-preview"
import { StudioProduceBar } from "./components/studio-produce-bar"
import { useStudioState } from "./hooks/use-studio-state"
import { useProduceVideo } from "./hooks/use-produce-video"

// ── page ─────────────────────────────────────────────────────────────────────

function VideoStudioContent() {
  const { isConnected, connection } = useAprimo()
  const searchParams = useSearchParams()
  const recordParam = searchParams.get("record")
  const basketParam = searchParams.get("requestId")

  const s = useStudioState({ recordParam, basketParam })

  const {
    produceVideo, producing, produceProgress, savedRecordId, savedRecordUrl,
    downloadVideo, downloading, downloadProgress,
    generatePreview, previewing, previewProgress,
    previewUrl, clearPreview,
  } = useProduceVideo({
    sortedClips: s.sortedClips,
    audioClips: s.audioClips,
    assets: s.assets,
    durations: s.durations,
    transitionClips: s.transitionClips,
    textClips: s.textClips,
    platform: s.platform,
    selectedFormat: s.selectedFormat,
    cropMode: s.cropMode,
    zoom: s.zoom,
    rotation: s.rotation,
    outputFormat: s.outputFormat,
    previewWidth: s.previewWidth,
    disableFades: s.disableFades,
    initialRecordId: recordParam,
  })

  const isBusy         = producing || previewing || downloading || s.loadingRecord
  const activeProgress = s.loadingRecord ? "Loading project…" : previewProgress ?? produceProgress ?? downloadProgress ?? ""
  const progressPct    = activeProgress.match(/(\d+)%/)?.[1]
  const progressValue  = progressPct != null ? parseInt(progressPct) : null

  return (
    <main className="flex-1 flex flex-col">

      <StudioDialogs
        loadDialogOpen={s.loadDialogOpen}
        setLoadDialogOpen={s.setLoadDialogOpen}
        loadInput={s.loadInput}
        setLoadInput={s.setLoadInput}
        loadError={s.loadError}
        setLoadError={s.setLoadError}
        onLoad={s.loadState}
        stateJson={s.stateJson}
        setStateJson={s.setStateJson}
        saveDialogOpen={s.saveDialogOpen}
        setSaveDialogOpen={s.setSaveDialogOpen}
        projectNameInput={s.projectNameInput}
        setProjectNameInput={s.setProjectNameInput}
        onSave={produceVideo}
        trimClipId={s.trimClipId}
        setTrimClipId={s.setTrimClipId}
        trimClip={s.trimClip}
        trimAsset={s.trimAsset}
        durations={s.durations}
        cropMode={s.cropMode}
        zoom={s.zoom}
        rotation={s.rotation}
        onTrimChange={s.handleTrimChange}
      />

      <div className="relative flex flex-col">
        {isBusy && (
          <div className="absolute inset-0 z-30 bg-background/60 backdrop-blur-[1px] cursor-wait" />
        )}

        <div className="flex h-[55vh] overflow-hidden">
          <StudioSidebar
            assets={s.assets}
            setAssets={s.setAssets}
            setDurations={s.setDurations}
            draggingId={s.draggingId}
            setDraggingId={s.setDraggingId}
            draggingTransitionType={s.draggingTransitionType}
            setDraggingTransitionType={s.setDraggingTransitionType}
            isConnected={isConnected}
            connection={connection}
            pendingBasketAssets={s.pendingBasketAssets}
          />

          <StudioPreview
            previewUrl={previewUrl}
            clearPreview={clearPreview}
            generatePreview={generatePreview}
            previewing={previewing}
            isBusy={isBusy}
            sortedClips={s.sortedClips}
            previewWidth={s.previewWidth}
            setPreviewWidth={s.setPreviewWidth}
          />

          <div className="shrink-0 border-l border-border">
            <VideoSettingsPanel
              platform={s.platform}
              formatIndex={s.formatIndex}
              cropMode={s.cropMode}
              zoom={s.zoom}
              rotation={s.rotation}
              outputFormat={s.outputFormat}
              formats={s.formats}
              selectedFormat={s.selectedFormat}
              onPlatformChange={(v) => { s.setPlatform(v); s.setFormatIndex(0) }}
              onFormatIndexChange={s.setFormatIndex}
              onCropModeChange={s.setCropMode}
              onZoomChange={s.setZoom}
              onRotationChange={s.setRotation}
              onOutputFormatChange={s.setOutputFormat}
            />
          </div>
        </div>

        <VideoTimeline
          sortedClips={s.sortedClips}
          setVideoClips={s.setVideoClips}
          transitionClips={s.transitionClips}
          setTransitionClips={s.setTransitionClips}
          audioClips={s.audioClips}
          setAudioClips={s.setAudioClips}
          textClips={s.textClips}
          setTextClips={s.setTextClips}
          assets={s.assets}
          durations={s.durations}
          trimClipId={s.trimClipId}
          setTrimClipId={s.setTrimClipId}
          draggingId={s.draggingId}
          setDraggingId={s.setDraggingId}
          draggingTransitionType={s.draggingTransitionType}
          setDraggingTransitionType={s.setDraggingTransitionType}
          videoEndTime={s.videoEndTime}
          disableFades={s.disableFades}
        />
      </div>

      <StudioProduceBar
        isBusy={isBusy}
        activeProgress={activeProgress}
        progressValue={progressValue}
        producing={producing}
        downloading={downloading}
        savedRecordUrl={savedRecordUrl}
        savedRecordId={savedRecordId}
        vsSettingsReady={s.vsSettingsReady}
        sortedClips={s.sortedClips}
        isDev={process.env.NODE_ENV === "development"}
        disableFades={s.disableFades}
        onDisableFadesChange={s.setDisableFades}
        onDownload={downloadVideo}
        onSaveOrUpdate={() => savedRecordId ? produceVideo() : s.setSaveDialogOpen(true)}
        onOpenStateDialog={s.buildStateJson}
        onOpenLoadDialog={() => { s.setLoadInput(""); s.setLoadError(null); s.setLoadDialogOpen(true) }}
      />

    </main>
  )
}

export default function VideoStudioPage() {
  return (
    <div className="bg-card flex flex-col">
      <Navbar />
      <Suspense fallback={null}>
        <VideoStudioContent />
      </Suspense>
      <Footer />
    </div>
  )
}
