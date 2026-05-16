"use client"

import { useState, useEffect, useRef } from "react"
import { useAprimo } from "@/context/aprimo-context"
import { generatePKCE, buildAuthorizationUrl } from "@/lib/pkce"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Pencil, Trash2, Plus, ArrowLeft } from "lucide-react"

const ENV_ENVIRONMENT = process.env.NEXT_PUBLIC_APRIMO_ENVIRONMENT ?? ""
const ENV_CLIENT_ID = process.env.NEXT_PUBLIC_APRIMO_CLIENT_ID ?? ""
const ENV_CLIENT_SECRET = process.env.NEXT_PUBLIC_APRIMO_CLIENT_SECRET ?? ""
const ALL_FROM_ENV = !!(ENV_ENVIRONMENT && ENV_CLIENT_ID && ENV_CLIENT_SECRET)


const ENV_VS_CONTENT_TYPE = process.env.NEXT_PUBLIC_VIDEO_STUDIO_CONTENT_TYPE ?? ""
const ENV_VS_CLASSIFICATION_ID = process.env.NEXT_PUBLIC_VIDEO_STUDIO_CLASSIFICATION_ID ?? ""
const ENV_VS_JSON_FIELD = process.env.NEXT_PUBLIC_VIDEO_STUDIO_JSON_FIELD ?? ""
const ENV_ASSOCIATED_ASSETS_FIELD = process.env.NEXT_PUBLIC_ASSOCIATED_ASSETS_RECORD_LINK_FIELD ?? ""
const SHOW_VS_SECTION = !ENV_VS_CONTENT_TYPE || !ENV_VS_CLASSIFICATION_ID || !ENV_VS_JSON_FIELD || !ENV_ASSOCIATED_ASSETS_FIELD

const LS_VS_CONTENT_TYPE = "aprimo_vs_content_type"
const LS_VS_CLASSIFICATION_ID = "aprimo_vs_classification_id"
const LS_VS_JSON_FIELD = "aprimo_vs_json_field"
const LS_ASSOCIATED_ASSETS_FIELD = "aprimo_associated_assets_record_link_field"

interface ConnectionProfile {
  id: string
  name: string
  environment: string
  clientId: string
  clientSecret: string
}

const PROFILES_KEY = "aprimo_profiles"
const LAST_PROFILE_KEY = "aprimo_last_profile_id"

function loadProfiles(): ConnectionProfile[] {
  try {
    const oldEnv = localStorage.getItem("aprimo_environment")
    const oldCid = localStorage.getItem("aprimo_client_id")
    if (oldEnv && oldCid && !localStorage.getItem(PROFILES_KEY)) {
      const migrated: ConnectionProfile[] = [{
        id: crypto.randomUUID(),
        name: oldEnv,
        environment: oldEnv,
        clientId: oldCid,
        clientSecret: localStorage.getItem("aprimo_client_secret") ?? "",
      }]
      localStorage.setItem(PROFILES_KEY, JSON.stringify(migrated))
      localStorage.removeItem("aprimo_environment")
      localStorage.removeItem("aprimo_client_id")
      localStorage.removeItem("aprimo_client_secret")
      return migrated
    }
    const raw = localStorage.getItem(PROFILES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistProfiles(profiles: ConnectionProfile[]) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
}

function startOAuth(environment: string, clientId: string, clientSecret: string) {
  generatePKCE().then(({ codeVerifier, codeChallenge }) => {
    const redirectUri = `${window.location.origin}/oauth/callback`
    sessionStorage.setItem("pkce_environment", environment)
    sessionStorage.setItem("pkce_client_id", clientId)
    sessionStorage.setItem("pkce_client_secret", clientSecret)
    sessionStorage.setItem("pkce_code_verifier", codeVerifier)
    sessionStorage.setItem("pkce_return_url", window.location.href)
    window.location.href = buildAuthorizationUrl(environment, clientId, codeChallenge, redirectUri)
  })
}

type View = "list" | "edit"

export function AprimoConfigDialog() {
  const { isConnected } = useAprimo()
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [view, setView] = useState<View>("list")
  const [editing, setEditing] = useState<ConnectionProfile | null>(null)
  const [formName, setFormName] = useState("")
  const [formEnvironment, setFormEnvironment] = useState("")
  const [formClientId, setFormClientId] = useState("")
  const [formClientSecret, setFormClientSecret] = useState("")
  const [formVsContentType, setFormVsContentType] = useState("")
  const [formVsClassificationId, setFormVsClassificationId] = useState("")
  const [formVsJsonField, setFormVsJsonField] = useState("")
  const [formAssociatedAssetsField, setFormAssociatedAssetsField] = useState("")
  const hasAttempted = useRef(false)

  function openDialog() {
    const loaded = loadProfiles()
    setProfiles(loaded)
    setView("list")
    setEditing(null)
    setOpen(true)
  }

  useEffect(() => {
    window.addEventListener("aprimo:open-config", openDialog)
    return () => window.removeEventListener("aprimo:open-config", openDialog)
  }, [])

  useEffect(() => {
    if (isConnected) return
    if (window.location.pathname.startsWith("/oauth")) return
    if (hasAttempted.current) return

    if (ALL_FROM_ENV) {
      hasAttempted.current = true
      startOAuth(ENV_ENVIRONMENT, ENV_CLIENT_ID, ENV_CLIENT_SECRET)
      return
    }

    if (window.location.pathname === "/") return
    hasAttempted.current = true

    const loaded = loadProfiles()
    setProfiles(loaded)
    if (loaded.length === 0) {
      setView("edit")
      setOpen(true)
    } else {
      const lastId = localStorage.getItem(LAST_PROFILE_KEY)
      const profile = (lastId ? loaded.find((p) => p.id === lastId) : null) ?? loaded[0]
      localStorage.setItem(LAST_PROFILE_KEY, profile.id)
      startOAuth(profile.environment, profile.clientId, profile.clientSecret)
    }
  }, [isConnected])

  function connectProfile(profile: ConnectionProfile) {
    localStorage.setItem(LAST_PROFILE_KEY, profile.id)
    setOpen(false)
    startOAuth(profile.environment, profile.clientId, profile.clientSecret)
  }

  function initVsFields() {
    setFormVsContentType(localStorage.getItem(LS_VS_CONTENT_TYPE) ?? "")
    setFormVsClassificationId(localStorage.getItem(LS_VS_CLASSIFICATION_ID) ?? "")
    setFormVsJsonField(localStorage.getItem(LS_VS_JSON_FIELD) ?? "")
    setFormAssociatedAssetsField(localStorage.getItem(LS_ASSOCIATED_ASSETS_FIELD) ?? "")
  }

  function openNew() {
    setEditing(null)
    setFormName("")
    setFormEnvironment("")
    setFormClientId("")
    setFormClientSecret("")
    initVsFields()
    setView("edit")
  }

  function openEdit(profile: ConnectionProfile) {
    setEditing(profile)
    setFormName(profile.name)
    setFormEnvironment(profile.environment)
    setFormClientId(profile.clientId)
    setFormClientSecret(profile.clientSecret)
    initVsFields()
    setView("edit")
  }

  function persistVsFields() {
    if (!ENV_VS_CONTENT_TYPE) localStorage.setItem(LS_VS_CONTENT_TYPE, formVsContentType.trim())
    if (!ENV_VS_CLASSIFICATION_ID) localStorage.setItem(LS_VS_CLASSIFICATION_ID, formVsClassificationId.trim())
    if (!ENV_VS_JSON_FIELD) localStorage.setItem(LS_VS_JSON_FIELD, formVsJsonField.trim())
    if (!ENV_ASSOCIATED_ASSETS_FIELD) localStorage.setItem(LS_ASSOCIATED_ASSETS_FIELD, formAssociatedAssetsField.trim())
  }

  function buildUpdatedProfile(): ConnectionProfile {
    return {
      id: editing?.id ?? crypto.randomUUID(),
      name: formName.trim() || formEnvironment.trim(),
      environment: formEnvironment.trim(),
      clientId: formClientId.trim(),
      clientSecret: formClientSecret.trim(),
    }
  }

  function saveProfile() {
    const profile = buildUpdatedProfile()
    const updated = editing
      ? profiles.map((p) => (p.id === editing.id ? profile : p))
      : [...profiles, profile]
    persistProfiles(updated)
    persistVsFields()
    setProfiles(updated)
    setView("list")
  }

  function saveAndConnect() {
    const profile = buildUpdatedProfile()
    const updated = editing
      ? profiles.map((p) => (p.id === editing.id ? profile : p))
      : [...profiles, profile]
    persistProfiles(updated)
    persistVsFields()
    localStorage.setItem(LAST_PROFILE_KEY, profile.id)
    setOpen(false)
    startOAuth(profile.environment, profile.clientId, profile.clientSecret)
  }

  function deleteProfile(id: string) {
    const updated = profiles.filter((p) => p.id !== id)
    persistProfiles(updated)
    setProfiles(updated)
  }

  const envTrimmed = formEnvironment.trim()
  const envAllowed = /^trial\d{3}$/.test(envTrimmed)
  const formValid = !!(envTrimmed && formClientId.trim() && envAllowed)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        {view === "list" ? (
          <>
            <DialogHeader>
              <DialogTitle>Aprimo Configuration</DialogTitle>
              <DialogDescription>
                {profiles.length === 0
                  ? "Add a profile to get started."
                  : "Select a profile to connect, or manage your saved profiles."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-1 min-h-[60px]">
              {profiles.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No profiles saved yet.</p>
              )}
              {profiles.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{p.environment}.dam.aprimo.com</div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Edit" onClick={() => openEdit(p)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive" title="Delete" onClick={() => deleteProfile(p.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" className="h-7 shrink-0" onClick={() => connectProfile(p)}>
                    Connect
                  </Button>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={openNew}>
                <Plus className="h-4 w-4" />
                Add profile
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit profile" : "Add profile"}</DialogTitle>
              <DialogDescription>Enter your Aprimo environment and PKCE registration credentials.</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">Profile name</Label>
                <Input
                  id="profile-name"
                  placeholder={formEnvironment || "My Aprimo"}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-environment">Environment</Label>
                <Input
                  id="profile-environment"
                  placeholder="yourtrial"
                  value={formEnvironment}
                  onChange={(e) => setFormEnvironment(e.target.value)}
                />
                {envTrimmed && !envAllowed ? (
                  <div className="space-y-0.5">
                    <p className="text-xs text-destructive">
                      Environment must match <span className="font-mono">trial</span> followed by three digits (e.g. <span className="font-mono">trial123</span>).
                    </p>
                    <p className="text-xs text-muted-foreground">
                      For other environments, please visit the{" "}
                      <a
                        href="https://github.com/Aprimo-Connect/aprimo-editor-tools"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-foreground transition-colors"
                      >
                        GitHub repository
                      </a>
                      {" "}linked in the footer — the README provides instructions for self-hosting.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Subdomain of your Aprimo trial instance — <span className="font-mono">trial123</span> for trial123.dam.aprimo.com
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-client-id">Client ID</Label>
                <Input
                  id="profile-client-id"
                  placeholder="your-client-id"
                  value={formClientId}
                  onChange={(e) => setFormClientId(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-client-secret">Client Secret</Label>
                <Input
                  id="profile-client-secret"
                  type="password"
                  placeholder="your-client-secret"
                  value={formClientSecret}
                  onChange={(e) => setFormClientSecret(e.target.value)}
                />
              </div>

              {SHOW_VS_SECTION && (
                <div className="border-t border-border pt-4 space-y-4">
                  <p className="text-xs font-medium text-muted-foreground">Video Studio — Save as Asset</p>
                  <p className="text-xs text-muted-foreground">These settings are shared across all connection profiles.</p>
                  {(!ENV_VS_CONTENT_TYPE || !ENV_VS_JSON_FIELD) && (
                    <div className="grid grid-cols-2 gap-3">
                      {!ENV_VS_CONTENT_TYPE && (
                        <div className="space-y-1.5">
                          <Label htmlFor="profile-vs-content-type">Content type</Label>
                          <Input
                            id="profile-vs-content-type"
                            placeholder="Video"
                            value={formVsContentType}
                            onChange={(e) => setFormVsContentType(e.target.value)}
                          />
                        </div>
                      )}
                      {!ENV_VS_JSON_FIELD && (
                        <div className="space-y-1.5">
                          <Label htmlFor="profile-vs-json-field">JSON field name</Label>
                          <Input
                            id="profile-vs-json-field"
                            placeholder="VideoStudioJson"
                            value={formVsJsonField}
                            onChange={(e) => setFormVsJsonField(e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {!ENV_ASSOCIATED_ASSETS_FIELD && (
                    <div className="space-y-1.5">
                      <Label htmlFor="profile-associated-assets-field">Associated assets field name</Label>
                      <Input
                        id="profile-associated-assets-field"
                        placeholder="AssociatedAssets"
                        value={formAssociatedAssetsField}
                        onChange={(e) => setFormAssociatedAssetsField(e.target.value)}
                      />
                    </div>
                  )}
                  {!ENV_VS_CLASSIFICATION_ID && (
                    <div className="space-y-1.5">
                      <Label htmlFor="profile-vs-classification-id">Classification ID</Label>
                      <Input
                        id="profile-vs-classification-id"
                        placeholder="00000000-0000-0000-0000-000000000000"
                        value={formVsClassificationId}
                        onChange={(e) => setFormVsClassificationId(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" className="sm:mr-auto" onClick={() => setView("list")}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button variant="outline" disabled={!formValid} onClick={saveProfile}>
                Save
              </Button>
              <Button disabled={!formValid} onClick={saveAndConnect}>
                Save &amp; Connect
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
