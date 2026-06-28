# PDF Editor

Browser-based PDF creation and editing — blank canvas or upload-and-annotate,
no accounts required. Works like Google Sheets: open the site, start
editing, it auto-saves. Offline = view only, editing needs a connection
to persist (it still works locally in memory while offline, it just won't
save until back online).

## Stack

- Frontend: React + TypeScript + Vite, Fabric.js (canvas editing),
  pdf.js (render uploaded PDFs), pdf-lib (export to real PDF), Zustand
  (state), idb (offline document cache), a service worker (offline app
  shell).
- Backend: Express + better-sqlite3, anonymous device-id based storage
  (no auth).

## Running locally

You'll need Node 18+ and internet access to install dependencies (this
project was scaffolded in a sandbox without npm registry access, so
`node_modules` has not been installed yet).

### 1. Backend

```bash
cd server
npm install
npm run dev
```

Starts the API on http://localhost:8787 and creates `data.sqlite` on
first run.

### 2. Frontend

```bash
# from the project root
npm install
cp .env.example .env   # adjust VITE_API_BASE if your backend runs elsewhere
npm run dev
```

Starts the app on http://localhost:5173 (Vite default).

## Project structure

```
src/
  types/document.ts      Core data model (PDFDocument, Page, PageObject)
  store/editorStore.ts   Zustand store — single source of truth for the doc
  components/
    PdfCanvas.tsx         Fabric.js canvas, syncs with the store
    Toolbar.tsx            Add text/shape/image buttons
    PageNav.tsx            Page list + add page
    UploadButton.tsx        Upload an existing PDF
  lib/
    exportPdf.ts          pdf-lib export to downloadable .pdf
    pdfUpload.ts           pdf.js: rasterize uploaded PDF pages
    api.ts                  Backend client
    deviceId.ts              Anonymous device identity
    offlineCache.ts          IndexedDB cache for offline viewing
  hooks/useAutoSave.ts    Debounced auto-save to backend

server/
  src/db.ts               SQLite schema + queries, scoped by device id
  src/index.ts             Express routes
```

## Known gaps / next steps

- No type-check has been run yet against the real library versions —
  expect a handful of small Fabric.js v6 / pdf-lib type fixes once you
  `npm install` and run `npx tsc --noEmit`.
- Page thumbnails in the sidebar are text labels, not visual previews.
- No undo/redo yet.
- No object property panel (font size, color picker, etc.) — objects are
  added with fixed defaults and can only be moved/resized/rotated so far.
- Device identity lives in localStorage only — clearing site data loses
  access to saved documents (no recovery mechanism, by design, since
  there are no accounts).
- SQLite is fine for a single-server MVP; swap `server/src/db.ts` for
  Postgres if/when you need multiple server instances.
