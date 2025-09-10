## Edumaps Notifier Extension — Basic Workflow (MV3)

### Components
- **Content script** (`scripts/content-script.ts`): Parses the target webpage, extracts the set of "boxes" (state), normalizes them, and communicates with the background.
- **Background service worker** (`scripts/service-worker.ts`): Receives snapshots, stores baselines, schedules/initiates comparisons, and raises notifications.
- **UI (popup)** (`ui/index.ts`, `ui/index.html`): Lets the user capture, compare, view change summaries, and manage the baseline.
- **Storage**: Uses `chrome.storage.local` for snapshots/baselines and lightweight metadata.

### High-level Flow
1. **User visits a supported page**
   - MV3 injects the content script per `manifest.json` matches.
   - The content script waits for DOM readiness.

2. **Content script captures snapshot**
   - Locates the relevant "boxes" on the page (DOM queries tailored to the site).
   - Extracts stable identifiers and values (e.g., title, status, timestamps, counts).
   - Normalizes into a JSON snapshot (sorted, trimmed, stable keys) to minimize noise.

3. **Send snapshot to background**
   - Content script sends `{ type: 'SNAPSHOT_READY', payload: { snapshot, url, capturedAt } }` via `chrome.runtime.sendMessage` or `chrome.runtime.connect`.

4. **Background stores and compares**
   - Derives a storage key from origin + path (e.g., `key = url.origin + url.pathname`).
   - Loads the stored baseline (if any) from `chrome.storage.local`.
   - Runs a diff: identifies `added`, `removed`, and `changed` boxes based on stable IDs/keys.
   - Updates storage:
     - If no baseline exists, saves the current snapshot as the baseline (first-capture flow).
     - If baseline exists, saves the latest snapshot and the computed diff summary.

5. **Notify on changes**
   - If `diff` is non-empty, background raises a notification (`chrome.notifications`) and updates the badge (`chrome.action.setBadgeText`).
   - Optionally, signals the content script to display an in-page overlay highlighting changes.

6. **User interaction via popup**
   - Popup can trigger actions:
     - Capture now (request a fresh snapshot from the content script).
     - Compare now (force a diff against the baseline).
     - Set current as baseline (acknowledge changes and update baseline).
     - View last change summary (added/removed/changed counts and details).

### Triggers
- **On navigation / page load**: Automatic capture (content script) then compare (background).
- **On schedule (optional)**: Background uses `chrome.alarms` to request fresh captures at intervals (if page access is available or via re-open prompts).
- **On-demand**: User clicks popup buttons to capture/compare/reset baseline.

### Data Model (storage overview)
- Keyed by page: `state:{origin}{pathname}`
  - `baseline`: normalized snapshot JSON
  - `latest`: last captured snapshot JSON
  - `diff`: { added: Box[], removed: Box[], changed: Array<{ id, before, after }> }
  - `meta`: { capturedAt, comparedAt, version }

### Diff Strategy
- Use a stable `id` per box (prefer server-rendered identifiers or deterministic selectors).
- Normalize values (trim strings, parse numbers/dates, sort lists) before diffing.
- Compute sets:
  - `added`: IDs present in latest but not in baseline
  - `removed`: IDs present in baseline but not in latest
  - `changed`: IDs present in both where any normalized field differs

### Messaging (typical messages)
- From content script → background:
  - `SNAPSHOT_READY` — submits a snapshot for storage/diff.
  - `REQUEST_BASELINE` — asks for current baseline to display overlays.
- From background → content script:
  - `REQUEST_SNAPSHOT` — asks the page to capture now.
  - `APPLY_OVERLAY` — instructs to highlight added/removed/changed boxes.
- From popup → background:
  - `CAPTURE_NOW`, `COMPARE_NOW`, `SET_BASELINE`, `GET_SUMMARY`

### Permissions (indicative)
- `storage`, `activeTab`, `scripting`, `notifications`, optionally `alarms`.

### Error Handling & Resilience
- Guard for empty/partial DOM (retry with exponential backoff or on `load`).
- Enforce storage size constraints (prune history, store minimal fields, compress if needed).
- Handle dynamic pages (debounce captures until DOM stabilizes).

### Development Notes
- TypeScript sources in `scripts/` and `ui/` compile to MV3-compatible JS.
- Keep selectors and normalization logic centralized for maintainability.
- Prefer pure functions for snapshot building and diffing to simplify testing.


