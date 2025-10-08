# Gemini Completeness Frontend

React + TypeScript single-page app that drives the Gemini completeness workflow. The interface wraps job creation, queue management, progress monitoring, exports, and model analytics around the FastAPI backend.

## Highlights
- Drag-and-drop queue table with live polling (every 5s) powered by TanStack Query.
- Bulk upload card with JSONL validation, unioned attribute mapping editor, queue placement controls, and job option toggles.
- Job detail drawer with live progress, per-domain completeness stats, cost summaries, and export shortcuts.
- Bulk actions (pause, resume, cancel, delete, reset) with confirmation prompts and optimistic UI feedback.
- Toast notifications, theme toggle (light/dark), and responsive layout tuned for large data tables.
- Local storage persistence for search filters, selected statuses, priority filters, and mapping history.

## Project Layout
- `src/App.tsx` – Primary UI. Contains upload flow, queue table, job detail drawer, model stats modal, and toast system.
- `src/lib/api.ts` – Typed API client wrapping backend endpoints (`/api/jobs`, `/api/job/{id}`, `/api/export`, etc.).
- `src/components/ThemeToggle.tsx` – Handles light/dark theme switching by toggling the `dark` class on `<html>`.
- `src/index.css` – Tailwind layer plus custom primitives (`.btn`, `.card`, `.drawer`, etc.).
- `vite.config.ts` – Vite 7 configuration (port 5431, React plugin, build output to `dist/`).
- `public/` – Static assets copied verbatim to the build output.

## Prerequisites
- Node.js **18+** (Node 20 LTS recommended).
- npm **9+** (or another compatible package manager such as pnpm or yarn).
- Running backend API (see `../wiser-gemini-completeness-backend/README.md`). The SPA assumes all API calls live under the same origin at `/api`.

## Setup & Local Development
```bash
cd wiser-gemini-completeness-frontend
npm install
```

### Develop with HMR
1. Start the backend on `http://localhost:8000` (or adjust accordingly).
2. Proxy API calls so the SPA and backend share an origin. Add the snippet below to a local-only copy of `vite.config.ts` (do not commit if your team prefers the plain config):
   ```ts
   export default defineConfig({
     plugins: [react()],
     server: {
       port: 5431,
       host: true,
       proxy: {
         '/api': { target: 'http://localhost:8000', changeOrigin: true },
       },
     },
   });
   ```
3. Run the dev server:
   ```bash
   npm run dev -- --host
   ```
4. Open `http://localhost:5431`. Because the API client uses relative URLs, requests are forwarded to the backend via the proxy above.

### Production Build
```bash
npm run build       # emits to dist/
npm run preview     # optional: serve the built assets locally
```
Copy `dist/` into `../wiser-gemini-completeness-backend/static/` (the helper script `../moveFrontendToBackend` automates the copy + git commits).

## Feature Guide
- **Upload card**
  - Accepts `.jsonl`, `.json`, `.ndjson`, `.txt`, and `.jsonb` files via click, drop, or paste.
  - Performs lightweight JSON validation client-side and shows invalid samples.
  - Builds a union of reference attribute keys across files and lets you rename/map them; history is cached in `localStorage` under `mapping_history_v1`.
  - Queue placement toggles (`Top of Queue` vs `Priority`) and worker count slider (`worker_concurrency` is capped at 64 server-side).
  - Optional toggles for image validation and Polaris verification of Google results (mirrors backend form fields).
  - Supports multi-file uploads; each file becomes an individual job and the queue is updated optimistically.

- **Queue table**
  - Filters by owner, status, priority, and search query with persistence across reloads.
  - Sorting (name, created date, manual order) plus inline priority editing (`P1`–`P5`).
  - Pagination (10/25/50 rows per page), bulk selection, and keyboard-accessible context menus for per-job actions.
  - Drag-and-drop reordering via `@dnd-kit` with optimistic UI and server reconciliation.
  - Progress pill renders live row counts (`pending`, `processing`, `done`, `error`) while jobs are running or pausing.

- **Job drawer & analytics**
  - Clicking a row opens the detail drawer with job metadata, cost totals, Gemini request counts, and domain-by-domain completeness metrics.
  - Export workflow surfaces status polling and download URLs, with toasts for each state transition.
  - Model statistics modal summarizes the active prompt templates and request/cost totals returned by `/api/stats/models`.

- **Feedback & UX**
  - Toast notifications use React state keyed by a UUID and auto-dismiss on user action.
  - Confirmation modals protect destructive operations (cancel, delete, reset) and require typing `confirm` when appropriate.
  - Theme toggle stores the preference and falls back to system `prefers-color-scheme`.

## Scripts
- `npm run dev` – Start Vite dev server (add a proxy as described above for API access).
- `npm run build` – Type-check (`tsc -b`) and create a production bundle in `dist/`.
- `npm run preview` – Serve the `dist/` output locally.
- `npm run lint` – Run ESLint across the project.

## Styling & Design System
Tailwind is configured via `tailwind.config.js` and `postcss.config.js`. Utility classes are combined with a small set of component classes defined in `src/index.css`. Variants for dark mode depend on toggling `.dark` on the root element; `ThemeToggle` persists the flag to `localStorage`.

## Tips
- TanStack Query stores job data under the `['jobs']` key; mutations invalidate that cache which triggers a refetch and keeps polling aligned with user actions.
- Filters, mapping history, and page size are cached in the browser (`localStorage` keys: `ownerFilter`, `statusFilter`, `prioFilter`, `jobsPageSize`, `mapping_history_v1`). Clearing storage resets the UI to defaults.
- If you need to hit a remote backend during development, update the proxy target or serve the built bundle via the backend itself to avoid CORS issues.

Feel free to extend `src/App.tsx` by splitting subsections into dedicated components once flows stabilize—the current single-file approach keeps rapid UI experimentation straightforward.
