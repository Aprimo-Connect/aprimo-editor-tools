# Aprimo Editor Tools

A Next.js application for connecting to Aprimo using PKCE authentication and working with your DAM environment.

> **This is a community-supported project and is not officially maintained or supported by Aprimo.**

> **Aprimo JS SDK** — This project relies on the [Aprimo JS SDK](https://github.com/Timw255/aprimo-js) by [@Timw255](https://github.com/Timw255) for all Aprimo API communication, PKCE authentication, and file upload.

## Tools

### Bulk Upload

Upload assets to Aprimo with metadata in bulk.

- Drag-and-drop or browse to select multiple files
- Define shared fields whose values apply to every asset in the batch
- Override fields per asset where values differ
- Supports single-line text, multi-line text, numeric, and classification field types
- Tracks upload progress and reports per-asset success or failure

### My Basket

Renders the contents of an Aprimo basket. Triggered via Aprimo page hook — record IDs are stored in Supabase and a handle is forwarded to the page. Use this as a starting point for building custom contact sheets or for exporting basket contents to Excel.

| Parameter | Source | Description |
|-----------|--------|-------------|
| `requestId` | Webhook (multi-record mode) | UUID handle used to fetch the record list from Supabase |

Webhook action: `mybasket` (default multi-record mode — no `&mode=singleitem`).

### Basket Editor

An editable, spreadsheet-style view of an Aprimo basket. Like My Basket, it is triggered via Aprimo page hook — record IDs are stored in Supabase and a handle is forwarded to the page. Pick the fields to show, edit their values inline, and save changes back to Aprimo in bulk.

| Parameter | Source | Description |
|-----------|--------|-------------|
| `requestId` | Webhook (multi-record mode) | UUID handle used to fetch the record list from Supabase |

Webhook action: `basketeditor` (default multi-record mode — no `&mode=singleitem`).

- Choose visible columns from the **Field Definitions** panel (tabbed by data type)
- Cells display formatted values and become editable on click — text, multi-line text (textarea), HTML, numeric, date, text list, classification, and option-list fields
- Classification / option values are edited with the same searchable single/multi pickers used elsewhere
- **Copy / paste** a cell's value and **drag-fill** down a column, spreadsheet-style
- Edited cells are highlighted; a single **Save changes** button writes all changed records via `records.update()` and reports per-record success / failure
- Pick the **Save language** for localized field values, and **Export to Excel** the displayed columns

### My Item

Displays a single Aprimo record. Triggered via Aprimo page hook — the record ID is passed directly as a query parameter.

| Parameter | Source | Description |
|-----------|--------|-------------|
| `record` | Webhook (`&mode=singleitem`) | The Aprimo record ID to display |

Webhook action: `myitem` with `&mode=singleitem` appended to the webhook URL.

### Video Resizer

Resize and reformat a video asset for social media platforms, then save it back to Aprimo as an additional file. Triggered via Aprimo page hook — the record ID is passed directly as a query parameter.

| Parameter | Source | Description |
|-----------|--------|-------------|
| `record` | Webhook (`&mode=singleitem`) | The Aprimo record ID whose master video file will be loaded |

Webhook action: `videoresizer` with `&mode=singleitem` appended to the webhook URL.

- Supports Instagram, YouTube, TikTok, Facebook, LinkedIn, and X with preset aspect ratios and resolutions
- Adjustable crop mode (fill / fit), zoom, and rotation
- Output formats: MP4, MOV, WebM
- Live preview updates as settings change
- **Create Rendition** — processes the video in the browser using FFmpeg.wasm and uploads the result to Aprimo as an additional file on the master file's latest version
- **Create & Download** — processes the video and triggers a local download without uploading to Aprimo

> FFmpeg.wasm requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` response headers on the `/video-resizer` route. These are already configured in `next.config.mjs`.

### Video Studio

A browser-based non-linear video editor. Select multiple Aprimo assets, arrange them on a timeline, add transitions, audio, and text overlays, then render the final video using FFmpeg.wasm — entirely in the browser with no server-side transcoding.

**Asset types**

| Type | Notes |
|------|-------|
| Video | MP4, MOV, WebM, AVI, MKV — trimmed and composited |
| Image | JPEG, PNG, WebP, etc. — held as a still for the clip duration |
| Audio | MP3, AAC, WAV, OGG, FLAC — placed on a separate audio track with independent trim |
| Text | Heading + body text burned into the video via `drawtext`; configurable font, size, color, opacity, and 9-point position grid |

**Timeline**

- Four tracks: **Video**, **Transitions**, **Audio**, and **Text**
- Drag assets from the sidebar onto any track
- Reorder and move video clips; set start times for audio and text clips
- Trim video clips with a frame-accurate trim editor (set in/out points)
- Mute individual video clips

**Transitions**

Drag a transition chip from the sidebar between two clips on the video track. Uses FFmpeg's `xfade` filter — supported types include fade, dissolve, wipe (left/right/up/down), slide, circle, pixelize, zoom, and more.

> **How transitions consume clip content.** An `xfade` transition of duration _N_ seconds works by blending the _last N seconds_ of clip A with the _first N seconds_ of clip B. This means those frames from both clips are visible but overlapped — they are not cut from the output, they are shared between the two clips during the blend. If this feels like frames are being lost, it is expected behavior: a 1-second fade will "use up" 1 second from the tail of clip A and 1 second from the head of clip B. To minimize this, shorten the transition duration — a 0.25-second fade consumes far less clip content than a 1-second fade — or use the **Disable Transitions** toggle for a hard cut (see below).

**Disable Transitions toggle**

The **Disable Transitions** switch in the bottom bar replaces all `xfade`/`acrossfade` filters with a simple frame-accurate `concat`. When enabled:

- The Transitions track is hidden and any placed transition chips are ignored during encoding.
- Clips are joined with a clean hard cut — no frames are shared between clips.
- Use this mode when exact clip boundaries matter more than visual blending effects.

**Output settings**

Choose a platform preset (YouTube, Instagram, TikTok, Facebook, LinkedIn, X, or custom), aspect ratio, crop mode (fill / fit), zoom, and rotation. Output formats: MP4 (H.264) and WebM (VP9).

**Actions**

| Button | Description |
|--------|-------------|
| Generate Preview | Renders a low-quality preview (360p / 720p / 1080p) for quick review |
| Create and Download | Renders the full-quality video and saves it to your machine |
| Save as Asset | Prompts for a project name, renders, uploads, and creates a new Aprimo record. On success, an **Open in Aprimo** button appears to jump to the new record. |
| State | Inspect the current project as JSON |
| Load | Restore a previously saved project from JSON |

**Save as Asset — environment variables**

The "Save as Asset" action requires additional env vars (see `.env.local.example`):

```
NEXT_PUBLIC_VIDEO_STUDIO_CONTENT_TYPE=              # content type name or ID for the new record
NEXT_PUBLIC_VIDEO_STUDIO_CLASSIFICATION_ID=         # classification ID (Aprimo records require at least one)
NEXT_PUBLIC_VIDEO_STUDIO_JSON_FIELD=                # field name used to store the project state JSON
NEXT_PUBLIC_ASSOCIATED_ASSETS_RECORD_LINK_FIELD=    # RecordLink field name used to link the source assets
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_VIDEO_STUDIO_CONTENT_TYPE` | Yes | Content type name or ID assigned to the saved video record |
| `NEXT_PUBLIC_VIDEO_STUDIO_CLASSIFICATION_ID` | Yes | Classification ID — Aprimo records require at least one |
| `NEXT_PUBLIC_VIDEO_STUDIO_JSON_FIELD` | Yes | Name of a JSON field; the full project state (clips, assets, settings) is written here so the project can be reloaded via the **Load** button |
| `NEXT_PUBLIC_ASSOCIATED_ASSETS_RECORD_LINK_FIELD` | No | Name of a RecordLink field on the video record; all Aprimo assets used in the project (video, image, audio) are written as linked records when the video is saved or updated |

If any of these variables are not set via the environment they can be entered in the **Connect** modal instead.

**Webhook actions**

Video Studio supports two webhook action modes:

| Action | Mode | Description |
|--------|------|-------------|
| `videostudiobasket` | Multi-record (default) | Select one or more assets in Aprimo and open Video Studio with those assets pre-loaded in the sidebar, ready to arrange on the timeline. |
| `videostudio` | Single-record (`&mode=singleitem`) | Open an existing Video Studio project record so you can edit it and save a new version. The project state stored in the JSON field is restored automatically. |

> FFmpeg.wasm requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` response headers on the `/video-studio` route. These are already configured in `next.config.mjs`.

### Dynamic Content

A multi-format template builder. Load an Aprimo asset, define a content layout once (headline, body text, CTA, logo) and styles, then add format cards — each renders the same content at a different size. Export the lot as a ZIP, drive variants from a spreadsheet, or publish renditions back to the source record as additional files.

| Parameter | Source | Description |
|-----------|--------|-------------|
| `requestId` | Webhook (multi-record mode) | UUID handle used to fetch the record list from Supabase |
| `record` | Webhook (`&mode=singleitem`) | Single Aprimo record ID to import directly |

**Workspace**

- Infinite canvas — pan, zoom, drag to position format cards, draw on empty space to create new formats
- Per-format anchor (9-point grid) with per-layer and per-asset overrides
- Focal-point picker with optional Aprimo smart-crop URLs
- Content / subject interference detection — a "Fix" button suggests the best non-overlapping anchor when text covers the focal subject
- Multi-asset projects — switch between assets, each with its own focal area
- Multi-project storage in `localStorage` — projects persist across reloads and can be exported / imported as JSON

**Layers**

- Headline, Text, CTA — independent font, weight, color, and gap settings
- Reorder, hide per format, or override anchor per layer
- Optional logo placed in any of 9 anchor positions

**Bulk data**

- Drag in a CSV / XLSX — auto-maps columns to layers by name
- Step through rows to preview each variant live on the canvas
- Export all rows × all formats as a single ZIP organised by row

**Actions**

| Button | Description |
|--------|-------------|
| Download All (ZIP) | Renders every format at full resolution and downloads as a zip |
| Publish to DAM | Renders every format and attaches each as an additional file on the source record's master file. Existing same-named renditions are replaced. |
| View in DAM | Appears once renditions are published — opens the source record in a new tab |
| Export All (bulk) | Renders rows × formats from the imported spreadsheet as a structured zip |

**Webhook actions**

| Action | Mode | Description |
|--------|------|-------------|
| `templatesbasket` | Multi-record (default) | Open Dynamic Content with selected DAM assets imported into a chosen project |
| `templates` | Single-record (`&mode=singleitem`) | Open Dynamic Content with a single asset imported |

When the page loads with `?requestId=` (or `?record=`) a project picker modal lets the user pick an existing project to import into, or create a new one. Assets are fetched via the SDK to resolve their CDN URLs.

> Logos load via `<img crossorigin="anonymous">`. Logos hosted on a CORS-permissive origin (Aprimo CDN, your own bucket) work; restrictive ones (HubSpot etc.) won't load — self-host or use an Aprimo CDN URL.

### Excel Import

Import metadata from an Excel file into Aprimo records.

- Upload an `.xlsx` / `.xls` file and select which columns to map
- Map Excel columns to Aprimo field definitions (auto-matched by name)
- Map classification and option-list values from the spreadsheet to Aprimo values (auto-matched by name/label; option lists honor the field's single- vs multi-select setting)
- Supports single-line / multi-line text, HTML, numeric, date / time, text list, classification, and option-list fields
- Date cells are normalized to the format each field type expects (`yyyy-MM-dd`, ISO 8601, or `HH:mm:ss`)
- **View contents** — preview the parsed sheet in a dialog; classification / option values that need manual matching are highlighted
- Choose the target language for localized field values
- Saves to Aprimo using `records.update()` with built-in rate-limit handling

### Duplicate Assets

Find and resolve duplicate assets by matching on the master file's **checksum** and/or **filename**. Opened from the home page or the navbar (no page hook required) — it loads automatically on connect.

- Builds the list by **faceting** on the `_Checksum` field, keeping values shared by more than one record, then fetching those records
- **Match on** dropdown — switch between **Checksum**, **Filename**, or **both** (both also matches the checksum + filename pair). Changing it refreshes the list
- Compact, clickable grid; each tile shows the filename and checksum
- Click an asset to open a **side-by-side comparison** of every metadata field against its duplicate, with mismatches highlighted
  - For mismatched fields, click either side to choose which value to keep, then **Apply selected to this asset**
  - **RecordLink** fields render the referenced assets (thumbnail + title) and, for multi-value links, offer a **Merge & dedupe** option that unions both sides' parents / children / links
  - **Delete duplicate** removes the matched record; if the surviving asset no longer matches any other record it drops from the list

#### Required global fields

The Duplicates tool requires **two global, indexed, single-line text fields** on your records: **`_Checksum`** and **`_Filename`**. (The field names are resolved by label/name, so minor variations are tolerated, but `_Checksum` / `_Filename` are expected.)

Populate them from the master file with Aprimo rule references:

```xml
<!-- _Checksum -->
<ref:record file="master" out="CRC32"/>

<!-- _Filename -->
<ref:record file="master" out="filename"/>
```

- Both fields must be **indexed** (searchable) so they can be faceted and queried.
- Configure both to **reset `OnMasterFileChange`** so the values stay in sync when a master file is replaced.
- For **existing assets**, the references only run on change — you may need to run a **maintenance job** (e.g. a field-resave / touch action) to populate `_Checksum` and `_Filename` across the current library before the tool can detect their duplicates.

## Data Flow

1. **Pagehook trigger** — The Aprimo UI sends a page hook POST to the Webhook Endpoint containing the action name and one or more record IDs.
2. **Store basket** — For multi-record actions the Webhook Endpoint stores the record list in the Basket Datastore (Supabase) and generates a short-lived `requestId` handle.
3. **Redirect** — The webhook returns the Editor Tools URL with the handle (or record ID for single-item mode). Aprimo opens that URL in the user's browser.
4. **PKCE auth** — Editor Tools automatically authenticates the user against the Aprimo User Interface via PKCE OAuth / SSO on page load, before making any API calls.
5. **Retrieve basket** — Once authenticated, the Editor Tools page fetches the record list from the Basket Datastore using the `requestId`, then deletes the row.

## Framework

### Authentication

Connects to Aprimo using the PKCE OAuth flow via the [Aprimo JS SDK](https://github.com/Timw255/aprimo-js). Connection profiles are saved in `localStorage` after first use.

The app authenticates automatically on page load:

- **With all three env vars set** — auto-connects on every page, no modal required.
- **Without env vars** — auto-connects on every page except the home page using the saved profile. If multiple profiles exist the selection modal is shown; if none exist the add-profile form is shown.

```
NEXT_PUBLIC_APRIMO_ENVIRONMENT=your-environment
NEXT_PUBLIC_APRIMO_CLIENT_ID=your-client-id
NEXT_PUBLIC_APRIMO_CLIENT_SECRET=your-client-secret
```

### Webhook / Page Hook endpoint

`POST /api/webhook` receives page hook calls from Aprimo and redirects to the appropriate page. Actions are configured in `app/api/webhook/actions.json`:

```json
{
  "mybasket":           "https://your-deployment.vercel.app/my-basket",
  "basketeditor":       "https://your-deployment.vercel.app/basket-editor",
  "myitem":             "https://your-deployment.vercel.app/my-item",
  "videoresizer":       "https://your-deployment.vercel.app/video-resizer",
  "videostudiobasket":  "https://your-deployment.vercel.app/video-studio",
  "videostudio":        "https://your-deployment.vercel.app/video-studio",
  "templatesbasket":    "https://your-deployment.vercel.app/templates",
  "templates":          "https://your-deployment.vercel.app/templates"
}
```

The action name in Aprimo maps to a key in that file. The record or basket ID is forwarded as a query parameter.

| Action | Mode | Tool |
|--------|------|------|
| `mybasket` | Multi-record (basket) | My Basket |
| `basketeditor` | Multi-record (basket) | Basket Editor |
| `myitem` | Single-record | My Item |
| `videoresizer` | Single-record | Video Resizer |
| `videostudiobasket` | Multi-record (basket) | Video Studio |
| `videostudio` | Single-record | Video Studio — opens an existing project |
| `templatesbasket` | Multi-record (basket) | Dynamic Content |
| `templates` | Single-record | Dynamic Content |

## Getting Started

### 1. Set up Supabase

The My Basket flow stores temporary record lists in Supabase.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase SQL editor, run the schema from [`supabase/create_requested_records.sql`](supabase/create_requested_records.sql) to create the `requested_records` table.
3. Copy your project URL and anon key from **Project Settings → API**.

### 2. Configure environment variables

Copy `.env.local.example` to `.env.local` and fill in the values:

```
# Supabase (required for My Basket and Video Studio basket)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Webhook secret — must match the secret configured in Aprimo's page hook settings
WEBHOOK_SECRET=your-webhook-secret

# Aprimo (optional — trial environments can enter these via the in-app Connect modal instead)
NEXT_PUBLIC_APRIMO_ENVIRONMENT=your-environment
NEXT_PUBLIC_APRIMO_CLIENT_ID=your-client-id
NEXT_PUBLIC_APRIMO_CLIENT_SECRET=your-client-secret

# Video Studio — Save as Asset (optional — only required if using that feature)
NEXT_PUBLIC_VIDEO_STUDIO_CONTENT_TYPE=              # content type name or ID for new records
NEXT_PUBLIC_VIDEO_STUDIO_CLASSIFICATION_ID=         # classification ID (records require at least one)
NEXT_PUBLIC_VIDEO_STUDIO_JSON_FIELD=                # field name used to store project state JSON
NEXT_PUBLIC_ASSOCIATED_ASSETS_RECORD_LINK_FIELD=    # RecordLink field to link source assets (optional)
```

### 3. Install and run

```
npm install
npm run dev
```

### 4. Connect to Aprimo

This app requires a **PKCE OAuth registration** in your Aprimo environment.

1. In Aprimo, go to **Settings → Registrations** and create a new registration with the following settings:
   - **Grant type:** Authorization Code with PKCE
   - **Redirect URI:** `https://<your-site>.vercel.app/oauth/callback` (or `http://localhost:3000/oauth/callback` for local development)
2. Note the **Client ID** and **Client Secret** from the registration.
3. Set the `NEXT_PUBLIC_APRIMO_*` environment variables above — the app will auto-connect on every page without showing a modal. If you are on a `trial\d{3}` environment (e.g. `trial123`) you can alternatively click **Connect** and enter your credentials directly in the modal.

### 5. Register page hooks (optional)

To enable the My Basket, My Item, Video Resizer, and Video Studio flows, register page hooks in Aprimo pointing to `/api/webhook`. Add your action-to-URL mappings in [`app/api/webhook/actions.json`](app/api/webhook/actions.json).

### 6. Set up action definitions and menus in Aprimo (optional)

To wire up a page hook action in Aprimo, create an action definition using the Aprimo settings UI or API. Use the following structure as a template:

```json
{
  "name": "<action name>",
  "type": "pageHook",
  "translationKey": "<translation key>",
  "conditions": [],
  "parameters": {
    "sendToken": "none",
    "url": "https://<your-site>.vercel.app/api/webhook?action=<action>",
    "location": "New",
    "timeout": 30,
    "httpMethod": "POST"
  }
}
```

- **`name`** — matches the key in `actions.json` (e.g. `mybasket`, `myitem`)
- **`url`** — the full URL to your deployed app's `/api/webhook` endpoint with the `action` query parameter
- **`translationKey`** — the label shown in Aprimo menus

**Webhook modes**

By default the webhook expects multiple record IDs, stores them in Supabase, and returns a handle (`requestId`) to the destination page. For actions that pass only a single record (e.g. My Item), append `&mode=singleitem` to the URL — the record ID is forwarded directly without a Supabase round-trip:

```
# Multi-record (default) — stores record list and returns a handle
url: https://<your-site>.vercel.app/api/webhook?action=mybasket

# Single-record — passes the record ID directly
url: https://<your-site>.vercel.app/api/webhook?action=myitem&mode=singleitem
```

Once the action definition is created, add it to the appropriate Aprimo menu so users can trigger it from the basket or record view. Each menu entry references the action by name:

```json
{
  "name": "<action name>",
  "type": "action"
}
```

## Reference

### Data Flow

![Data Flow](public/images/data-flow.png)
