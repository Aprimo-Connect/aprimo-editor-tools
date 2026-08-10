# Aprimo Editor Tools

A Next.js application for connecting to Aprimo using PKCE authentication and working with your DAM environment.

> **This is a community-supported project and is not officially maintained or supported by Aprimo.**

> **Aprimo JS SDK** — This project relies on the [Aprimo JS SDK](https://github.com/Timw255/aprimo-js) by [@Timw255](https://github.com/Timw255) for all Aprimo API communication, PKCE authentication, and file upload.

## Tools

### My Basket

Renders the contents of an Aprimo basket. Triggered via Aprimo page hook — record IDs are stored in Supabase and a handle is forwarded to the page. Use this as a starting point for building custom contact sheets or for exporting basket contents to Excel.

| Parameter | Source | Description |
|-----------|--------|-------------|
| `requestId` | Webhook (multi-record mode) | UUID handle used to fetch the record list from Supabase |

Webhook action: `my-basket` (default multi-record mode — no `&mode=singleitem`).

### My Item

Displays a single Aprimo record. Triggered via Aprimo page hook — the record ID is passed directly as a query parameter.

| Parameter | Source | Description |
|-----------|--------|-------------|
| `record` | Webhook (`&mode=singleitem`) | The Aprimo record ID to display |

Webhook action: `my-item` with `&mode=singleitem` appended to the webhook URL.

---

### Asset Usage

View engagement analytics for an Aprimo record — views, downloads, impressions, and plays — powered by the Aprimo Analytics API. Triggered via Aprimo page hook or opened directly with a `?record=` query parameter.

| Parameter | Source | Description |
|-----------|--------|-------------|
| `record` | Webhook (`&mode=singleitem`) | The Aprimo record ID to show analytics for |

Webhook action: `asset-usage` with `&mode=singleitem` appended to the webhook URL.

**Metrics**

| Metric | Description |
|--------|-------------|
| Views | Total record views in the selected date range |
| Downloads | Total file downloads |
| Impressions | Total embed/link impressions tracked via UTM parameters |
| Plays | Total preview playbacks |

- **Date range selector** — 30 days, 90 days, 6 months, 1 year, or all time
- **Engagement chart** — line chart with one line per metric; all lines shown by default
- **Metric tiles** — act as both stat cards and tab controls; clicking a tile highlights its chart line and shows its detail table; clicking again deselects
- **Views by user** — date, login ID, and view count per user per day
- **Downloads by user** — date, login ID, and download count per user per day
- **Plays by user** — date, login ID, and play count per user per day
- **Impressions by day & UTM** — date, UTM parameter key, UTM value, and impression count

---

### Basket Editor

An editable, spreadsheet-style view of an Aprimo basket. Like My Basket, it is triggered via Aprimo page hook — record IDs are stored in Supabase and a handle is forwarded to the page. Pick the fields to show, edit their values inline, and save changes back to Aprimo in bulk.

| Parameter | Source | Description |
|-----------|--------|-------------|
| `requestId` | Webhook (multi-record mode) | UUID handle used to fetch the record list from Supabase |

Webhook action: `basket-editor` (default multi-record mode — no `&mode=singleitem`).

- Choose visible columns from the **Field Definitions** panel (tabbed by data type)
- Cells display formatted values and become editable on click — text, multi-line text (textarea), HTML, numeric, date, text list, classification, and option-list fields
- Classification / option values are edited with the same searchable single/multi pickers used elsewhere
- **Copy / paste** a cell's value and **drag-fill** down a column, spreadsheet-style
- Edited cells are highlighted; a single **Save changes** button writes all changed records via `records.update()` and reports per-record success / failure
- Pick the **Save language** for localized field values, and **Export to Excel** the displayed columns

### Bulk Upload

Upload assets to Aprimo with metadata in bulk.

- Drag-and-drop or browse to select multiple files
- Define shared fields whose values apply to every asset in the batch
- Override fields per asset where values differ
- Supports single-line text, multi-line text, numeric, and classification field types
- Tracks upload progress and reports per-asset success or failure

### Creative Template

A two-page workflow for designing reusable canvas layouts and filling them with DAM content to produce finished assets.

#### Creative Template Create (`/creative-template-create`)

A visual canvas editor for building multi-layer templates. Designs can be imported from Figma or HTML, or built from scratch.

**Layers**

| Type | Notes |
|------|-------|
| Text | Font family, size, weight, color, alignment, line height, text transform; optional Figma color-run spans |
| Image | URL or DAM asset; cover / contain / fill mode |
| Shape | Rectangle or ellipse; solid fill, image fill, or none; stroke and corner radius; child layers |
| Button | Label, font, background color, border radius |

- Layers can be locked (fixed in the final asset) or left editable for fill-time override
- **Text field binding** — a text layer can be set to _Free text_ (editable directly at fill time) or bound to an _Aprimo field_ (content type + field name pair). At fill time the bound field's value is pulled from the selected record automatically
- **HTML import** — paste raw HTML markup; the browser performs a real layout pass and the element tree is converted to canvas layers; a live scaled preview renders alongside the source
- **Figma import** — paste a Figma file URL and personal access token to pull frames, groups, and auto-layout nodes directly into the canvas; effects (drop shadows, blurs) are imported
- **Save to Aprimo** — the canvas layout JSON is stored in a long-text field on a new Aprimo record; a PNG thumbnail is attached as the master file. Re-saving updates the existing record
- **Edit existing template** — opening the page with `?record=<recordId>` loads an existing canvas template record for editing

**Aprimo setup**

Before using the Creative Template tools, create the following in Aprimo:

1. **A field to store the layout JSON** — create a **Multi-line text** (or JSON) field in Aprimo. The field name (not its display label) goes in `NEXT_PUBLIC_CANVAS_TEMPLATE_JSON_FIELD`. The full canvas layout — every layer, its geometry, text content, image source, and Aprimo field bindings — is serialised as JSON and written to this field whenever a template is saved. It is also read back when loading a template for editing or filling, so the field must be read/write and not subject to a character limit that would truncate the JSON.

2. **A content type for canvas template records** — create (or designate) a content type in Aprimo for canvas template records. Register the layout JSON field on this content type. The content type's **name** or **ID** goes in `NEXT_PUBLIC_CANVAS_TEMPLATE_CONTENT_TYPE`. Every template saved from the Create page is stored as a record of this content type.

3. **A classification** — canvas template records require at least one classification. Copy the classification ID from Aprimo and set it as `NEXT_PUBLIC_CANVAS_TEMPLATE_CLASSIFICATION_ID`. All new template records and filled output assets receive this classification.

**Environment variables**

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_CANVAS_TEMPLATE_CONTENT_TYPE` | Yes | Name or ID of the Aprimo content type used for canvas template records (see setup above) |
| `NEXT_PUBLIC_CANVAS_TEMPLATE_JSON_FIELD` | Yes | Internal **name** (not label) of the multi-line text field that stores the canvas layout JSON (see setup above) |
| `NEXT_PUBLIC_CANVAS_TEMPLATE_CLASSIFICATION_ID` | Yes | Classification ID added to every new canvas template record and filled output asset |

**Webhook actions**

| Action | Mode | Description |
|--------|------|-------------|
| `creative-template-create` | Single-record (`&mode=singleitem`) | Open an existing canvas template record for editing |

#### Creative Template Fill (`/creative-template-fill`)

Opens a saved canvas template and lets users fill its editable fields, then saves the result as a new Aprimo asset. Always opened via page hook from a canvas template record.

**Editable fields**

| Field type | Fill behaviour |
|-----------|----------------|
| Text — free text | Editable textarea |
| Text — Aprimo field binding | **Select record** opens the Aprimo content selector (single mode); the bound metadata field value is fetched from the chosen record automatically; textarea is read-only |
| Image | **Browse DAM** opens the Aprimo content selector (single rendition mode) to pick a specific rendition; fit toggle (cover / contain / fill); URL input as fallback |

- Multi-canvas templates show a tab strip; zoom controls (in / out / fit) are provided
- **Save asset** — renders the filled canvas to PNG and creates a new Aprimo record; prompts for an asset name and content type before saving

**Webhook actions**

| Action | Mode | Description |
|--------|------|-------------|
| `creative-template-fill` | Single-record (`&mode=singleitem`) | Open a canvas template record for fill — loads the layout from the record's JSON field |

> Both canvas template actions use the same `NEXT_PUBLIC_CANVAS_TEMPLATE_*` environment variables as the create page.

---

### DAM Usage Dashboard

A live example of what's possible with the [Aprimo Analytics API](https://developers.aprimo.com/docs/reporting/analytics-api) — every metric is queried in real time with no data warehouse or pre-aggregation required. Opened directly from the home page — no page hook required.

> For production reporting, scheduled exports, and enterprise-scale visualisations, connecting a dedicated BI tool such as **Power BI** directly to the Analytics API is strongly recommended.

- **Assets tile** — total record count in the DAM, scoped to the active collection or classification filter
- **KPI tiles** — total views, downloads, impressions, plays, and active users for the selected date range; tiles act as tab controls that drill into a detail table
- **Engagement chart** — line chart with one line per metric over time
- **Top assets** — most-viewed and most-downloaded records in the selected period
- **Filter by collection** — scope all metrics to a static Aprimo collection
- **Filter by classification** — scope all metrics to a classification subtree; the dropdown renders the full hierarchy with expand/collapse, using English display labels from the DAM
- **Active users** — top users by views, downloads, or plays; drill into a single user to see their personal engagement chart and top assets
- **UTM data** — impression breakdown by UTM parameter key and value

**Filters and date range**

| Control | Description |
|---------|-------------|
| Date range | 30 days, 90 days, 6 months, 1 year, all time |
| Collection | Filter to a static Aprimo collection (mutually exclusive with classification) |
| Classification | Filter to a classification subtree rooted at the env-var node (mutually exclusive with collection) |

**Environment variables**

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_DAM_DASHBOARD_LABEL_FIELD` | No | Internal field name used to display asset titles in lists (e.g. `title`). Falls back to a truncated record ID when unset. |
| `NEXT_PUBLIC_DAM_DASHBOARD_CLASSIFICATION_ROOT_ID` | No | GUID of the root classification node for the classification filter dropdown. When unset the classification filter is hidden. |

---

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
| `templates-basket` | Multi-record (default) | Open Dynamic Content with selected DAM assets imported into a chosen project |
| `templating` | Single-record (`&mode=singleitem`) | Open Dynamic Content with a single asset imported |

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

### Text to Speech

Convert a script to AI-generated audio via ElevenLabs and save it back to Aprimo — either attached to an existing record or as a new record. Demonstrates how to expose governed AI audio creation to corporate users.

Can be triggered via Aprimo page hook (single-record mode) or opened directly from the home page to create a new record from scratch.

| Parameter | Source | Description |
|-----------|--------|-------------|
| `record` | Webhook (`&mode=singleitem`) | Aprimo record ID to read `_Script` and `DisplayTitle` fields from and attach audio to. Omit to create a new record. |

Webhook action: `text-to-speech` with `&mode=singleitem` appended to the webhook URL.

**Pipeline — existing record**

1. Reads the `_Script` field value from the record
2. Generates audio via ElevenLabs TTS
3. Changes the record's content type and title (`<Title> Audio`) in Aprimo
4. Uploads the audio file
5. Attaches it as the master file on the record

**Pipeline — new record**

1. User enters a title and script directly on the page
2. Generates audio via ElevenLabs TTS
3. Uploads the audio file
4. Creates a new Aprimo record with the audio as the master file, applying the configured content type and classification

**Environment variables**

| Variable | Required | Description |
|----------|----------|-------------|
| `ELEVENLABS_API_KEY` | Yes | ElevenLabs API key — server-side only, never exposed to the browser |
| `ELEVENLABS_TTS_VOICE_ID` | No | Default ElevenLabs voice ID. Defaults to Rachel (`21m00Tcm4TlvDq8ikWAM`) if unset. Voice can also be selected in the UI. |
| `NEXT_PUBLIC_AUDIO_CONTENT_TYPE` | No | Content type name or ID to pre-fill the content type field in the UI |
| `NEXT_PUBLIC_TTS_CLASSIFICATION_ID` | Yes (new records) | Classification ID applied when creating new records. Required when no `?record=` is provided. |

---

### Translate Video

Translate a video asset into another language using the ElevenLabs Dubbing API, then save the result as a new Aprimo record. Triggered via Aprimo page hook — the record ID is passed directly as a query parameter.

| Parameter | Source | Description |
|-----------|--------|-------------|
| `record` | Webhook (`&mode=singleitem`) | The Aprimo record ID of the source video |

Webhook action: `translate-video` with `&mode=singleitem` appended to the webhook URL.

**Pipeline**

1. Creates an Aprimo download order to obtain a CDN URL for the source video
2. Submits the URL directly to the ElevenLabs Dubbing API (the file never transits the server)
3. Polls until dubbing completes (up to 15 minutes)
4. Downloads the dubbed video via a server-side proxy
5. Uploads the dubbed video to Aprimo
6. Creates a new Aprimo record; the filename is prefixed with the target language name (e.g. `[Spanish] my-video.mp4`)

**Target languages**

Spanish, French, German, Italian, Portuguese, Polish, Hindi, Japanese, Korean, Chinese, Arabic, Dutch, Turkish, Swedish.

**Environment variables**

| Variable | Required | Description |
|----------|----------|-------------|
| `ELEVENLABS_API_KEY` | Yes | ElevenLabs API key — server-side only, never exposed to the browser |

---

### Video Resizer

Resize and reformat a video asset for social media platforms, then save it back to Aprimo as an additional file. Triggered via Aprimo page hook — the record ID is passed directly as a query parameter.

| Parameter | Source | Description |
|-----------|--------|-------------|
| `record` | Webhook (`&mode=singleitem`) | The Aprimo record ID whose master video file will be loaded |

Webhook action: `video-resizer` with `&mode=singleitem` appended to the webhook URL.

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

**Save as Asset — Aprimo setup**

Before using "Save as Asset", create the following in Aprimo:

1. **A field to store the project state JSON** — create a **Multi-line text** (or JSON) field. The field's internal **name** (not its display label) goes in `NEXT_PUBLIC_VIDEO_STUDIO_JSON_FIELD`. The full project state — clips, trim points, transitions, audio, text overlays, and output settings — is serialised as JSON and written to this field on every save. It is read back when a video record is opened for editing, so the field must be read/write and must not have a character limit that would truncate the JSON.

2. **A content type for video project records** — create (or designate) a content type in Aprimo for saved video projects. Register the project state JSON field on this content type. The content type's **name** or **ID** goes in `NEXT_PUBLIC_VIDEO_STUDIO_CONTENT_TYPE`. Every video saved from Video Studio is stored as a record of this content type, with the rendered MP4 attached as the master file.

3. **A classification** — video project records require at least one classification. Copy the classification ID from Aprimo and set it as `NEXT_PUBLIC_VIDEO_STUDIO_CLASSIFICATION_ID`.

4. **A RecordLink field for source assets** _(optional)_ — if you want Video Studio to record which Aprimo assets were used as source clips, create a **Record link** field and register it on the video content type. Set its internal name as `NEXT_PUBLIC_ASSOCIATED_ASSETS_RECORD_LINK_FIELD`. All video, image, and audio assets used in the project are written as linked records when the video is saved.

**Save as Asset — environment variables**

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_VIDEO_STUDIO_CONTENT_TYPE` | Yes | Name or ID of the Aprimo content type used for saved video project records (see setup above) |
| `NEXT_PUBLIC_VIDEO_STUDIO_CLASSIFICATION_ID` | Yes | Classification ID added to every new video project record |
| `NEXT_PUBLIC_VIDEO_STUDIO_JSON_FIELD` | Yes | Internal **name** (not label) of the multi-line text field that stores the full project state JSON (see setup above) |
| `NEXT_PUBLIC_ASSOCIATED_ASSETS_RECORD_LINK_FIELD` | No | Internal name of a RecordLink field; all source assets (video, image, audio) used in the project are written as linked records |

All variables must be set via environment variables — they are not configurable in the Connect modal.

**Webhook actions**

Video Studio supports two webhook action modes:

| Action | Mode | Description |
|--------|------|-------------|
| `video-studio-basket` | Multi-record (default) | Select one or more assets in Aprimo and open Video Studio with those assets pre-loaded in the sidebar, ready to arrange on the timeline. |
| `video-studio` | Single-record (`&mode=singleitem`) | Open an existing Video Studio project record so you can edit it and save a new version. The project state stored in the JSON field is restored automatically. |

> FFmpeg.wasm requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` response headers on the `/video-studio` route. These are already configured in `next.config.mjs`.

---

### Package Designer

Build and edit Aprimo package ingestion configurations (`.packageIngestionConfiguration`). Opens directly from the home page — no page hook required. Does not write back to Aprimo; the final XML is copied to the clipboard for pasting into the Aprimo system setting.

**Workflow**

1. Optionally drop a `.zip` file onto the file tree panel. The zip is parsed in-browser and its contents are shown as a navigable tree. File names are color-coded by role (primary, preview, additional, linked-pubItem, linked-recordLink) based on the active package's regex rules, and role badges appear inline.
2. On the **Current Config** tab, load the existing `.packageIngestionConfiguration` from your Aprimo environment (**Load package definitions from Aprimo**), or start with **New Package**.
3. The package list shows all packages in evaluation-priority order (top = first evaluated). When a zip is loaded, each package's identification rules are tested and the cards show match / partial-match / no-match indicators. If more than one package fully matches the zip, the lower-priority duplicates are flagged with an orange **"hidden by …"** badge alongside the green match badge.
4. Reorder packages with the ↑ / ↓ buttons. Delete with the trash icon.
5. Click **XML** on any card to open an editable XML dialog pre-filled with the package's current generated XML. Edit directly, **Validate** to check syntax, **Apply** to commit, or **Copy** to grab the text.
6. Click **Edit** on a card (or use the **Configure** tab) to open the form editor for that package.
7. On the **Configure** tab, set identification rules (with a **Test Match** button to check against the loaded zip), primary file and preview regexes, additional files (with purpose and usages), and linked records (with link type, duplicate checking, content type, and classifications). Clicking any regex input highlights its matches in the file tree live.
8. Click a file or folder in the tree to open the assignment panel. A visual segment builder lets you toggle each path part between exact / extension / wildcard modes and shows a plain-English description of the resulting pattern. Switch to raw regex mode for full control. Choose a role (identification, primary, preview, additional, linked record) and click **Apply** to write the regex into the config.
9. On the **XML Output** tab, review the merged `<packages>` XML for all packages in list order, then **Copy XML** to paste into the Aprimo `.packageIngestionConfiguration` system setting.

**Current Config tab — package cards**

| Indicator | Meaning |
|-----------|---------|
| ✓ green / "matches zip" | All identification rules matched the loaded zip |
| ½ amber | Some but not all identification rules matched |
| ✗ grey | No identification rules matched |
| Orange "hidden by …" | Package matches, but a higher-priority package also matches — Aprimo would stop at the first match and never reach this one |

**Configure tab — package sections**

| Section | Description |
|---------|-------------|
| Package | Name, enabled toggle, content type (detect / fixed / keep) |
| Identification Rules | Regexes Aprimo uses to detect the package type; all rules must match (AND logic); preset buttons for common types (InDesign, Photoshop, Illustrator, etc.) |
| Primary File | Regex for the master file; optional preview regex |
| Additional Files | One or more regexes with optional purpose (`review`, `spinset`, `3dpreview`) and usages |
| Linked Records | One or more regexes with link type (`pubItem` / `recordLink`), duplicate-check mode, content type, and classifications |

---

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
  "my-basket":                   "https://www.aprimo-editor-tools.app/my-basket",
  "basket-editor":               "https://www.aprimo-editor-tools.app/basket-editor",
  "my-item":                     "https://www.aprimo-editor-tools.app/my-item",
  "video-resizer":               "https://www.aprimo-editor-tools.app/video-resizer",
  "video-studio-basket":         "https://www.aprimo-editor-tools.app/video-studio",
  "video-studio":                "https://www.aprimo-editor-tools.app/video-studio",
  "templates-basket":            "https://www.aprimo-editor-tools.app/templates",
  "templating":                  "https://www.aprimo-editor-tools.app/templating",
  "creative-template-create":    "https://www.aprimo-editor-tools.app/creative-template-create",
  "creative-template-fill":      "https://www.aprimo-editor-tools.app/creative-template-fill",
  "translate-video":             "https://www.aprimo-editor-tools.app/translate-video",
  "text-to-speech":              "https://www.aprimo-editor-tools.app/text-to-speech",
  "asset-usage":                 "https://www.aprimo-editor-tools.app/asset-usage"
}
```

The action name in Aprimo maps to a key in that file. The record or basket ID is forwarded as a query parameter.

> **Backward compatibility** — the file also contains the original camelCase action names (e.g. `mybasket`, `basketeditor`, `videostudio`) pointing to the legacy Vercel deployment. Existing Aprimo page hook configurations using those names continue to work without changes.

| Action | Mode | Tool |
|--------|------|------|
| `my-basket` | Multi-record (basket) | My Basket |
| `basket-editor` | Multi-record (basket) | Basket Editor |
| `my-item` | Single-record | My Item |
| `video-resizer` | Single-record | Video Resizer |
| `video-studio-basket` | Multi-record (basket) | Video Studio |
| `video-studio` | Single-record | Video Studio — opens an existing project |
| `templates-basket` | Multi-record (basket) | Dynamic Content |
| `templating` | Single-record | Dynamic Content |
| `creative-template-create` | Single-record | Creative Template — open existing template for editing |
| `creative-template-fill` | Single-record | Creative Template — fill a template and save as asset |
| `translate-video` | Single-record | Translate Video |
| `text-to-speech` | Single-record | Text to Speech — generate audio from a record's `_Script` field |
| `asset-usage` | Single-record | Asset Usage — engagement analytics for a record |

## Getting Started

### 1. Set up Supabase

The My Basket flow stores temporary record lists in Supabase.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase SQL editor, run the schema from [`supabase/create_requested_records.sql`](supabase/create_requested_records.sql) to create the `requested_records` table.
3. Copy your project URL and anon key from **Project Settings → API**.

### 2. Configure environment variables

Copy `.env.local.example` to `.env.local` and fill in the values. The example file is the authoritative reference — each variable is documented inline with whether it is required or optional and what it controls.

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

- **`name`** — matches the key in `actions.json` (e.g. `my-basket`, `my-item`)
- **`url`** — the full URL to your deployed app's `/api/webhook` endpoint with the `action` query parameter
- **`translationKey`** — the label shown in Aprimo menus

**Webhook modes**

By default the webhook expects multiple record IDs, stores them in Supabase, and returns a handle (`requestId`) to the destination page. For actions that pass only a single record (e.g. My Item), append `&mode=singleitem` to the URL — the record ID is forwarded directly without a Supabase round-trip:

```
# Multi-record (default) — stores record list and returns a handle
url: https://<your-site>/api/webhook?action=my-basket

# Single-record — passes the record ID directly
url: https://<your-site>/api/webhook?action=my-item&mode=singleitem
```

Once the action definition is created, add it to the appropriate Aprimo menu so users can trigger it from the basket or record view. Each menu entry references the action by name:

```json
{
  "name": "<action name>",
  "type": "action"
}
```

**Example page hook configurations**

[`app/api/webhook/example-pagehooks.json`](app/api/webhook/example-pagehooks.json) contains ready-to-use action definition JSON for all 11 supported page hook actions. Each entry includes the action name, URL (with `https://<your-app-url>` as a placeholder), a 30-second timeout, and an `Administrators` group condition so only admins see the menu item by default.

To use it:
1. Replace `<your-app-url>` throughout the file with your actual deployment URL (e.g. `aprimo-editor-tools.vercel.app`).
2. Import each action definition into Aprimo via the Settings UI or the Aprimo API.
3. Adjust the `conditions` array on each entry — for example, to expand visibility beyond Administrators or add content-type filters.

## Reference

### Data Flow

![Data Flow](public/images/data-flow.png)
