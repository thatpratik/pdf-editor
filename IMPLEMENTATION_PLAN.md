# Implementation Plan

Derived from `PRD.md` (what to build) and `CONSTITUTION.md` (how — tech stack and architecture principles). This plan builds incrementally on the codebase already in place (Vite + React + TypeScript, Tailwind, `pdfjs-dist` wrapper, and the single-file upload/thumbnail/preview viewer shipped as iteration 1 — see `docs/diary/2026-08-20-project-bootstrap.md`).

Each phase produces something visually runnable end-to-end before the next one starts, per the project's own "get something visual running first" principle. Phases are ordered so each one's data model and plumbing is reused by the next, and so the two genuinely hard, open-ended problems (in-place text and image editing) come last, after everything mechanical is solid.

## Baseline (already built)

- `src/lib/pdf.ts` — pdf.js wrapper: `loadPdfDocument(source: Blob): Promise<PDFDocumentProxy>` (patched with a working `.destroy()`), `getPageCount(doc)`, `renderPageToCanvas(doc, pageNumber, canvas, scale): PageRenderHandle` (`{ promise, cancel }`).
- `src/features/viewer/` — single-file upload, thumbnail grid, larger page preview, loading/error states. View-only, no editing, no export.
- No `@pdfme/pdf-lib`, no drag-and-drop library, no zip library installed yet.

## Shared architecture introduced in Phase 1 (used by every later phase)

### Data model

A single flat "working set" of pages replaces the current single-`doc` state. This is what makes multi-file merge, single-file reorder, delete, rotate, and (later) split all the same underlying operation: rearranging/filtering one array.

```ts
// src/features/workspace/types.ts
interface SourceFile {
  id: string                    // crypto.randomUUID(), stable for the session
  name: string                  // File.name, for display
  file: File                    // kept for re-reading bytes on export (pdf-lib needs raw bytes, not the pdf.js handle)
  doc: PDFDocumentProxy         // pdf.js handle, used only for rendering (thumbnails/preview)
}

interface WorkingPage {
  id: string                    // crypto.randomUUID(), stable identity across reorders — this is the react key and the dnd-kit sortable id
  sourceFileId: string          // which SourceFile this page's content comes from
  sourcePageNumber: number      // 1-based page number within that source file (never changes)
  rotation: 0 | 90 | 180 | 270  // rotation ADDED in this session, on top of whatever the page's own rotation already is
  edits: PageEdit[]             // text/image edits applied on top of the original page content — see Phases 7-8; empty until those phases exist
}

// A page edit is DATA, not a live pdf-lib document mutation. This is what lets `buildPdf`
// (Phase 2) stay a pure, stateless function — safe to call repeatedly (download, extract,
// split) and still reflect every edit made so far — and what lets undo/redo (Phase 4) cover
// text/image edits for free, since they live on `WorkingPage` exactly like rotation does.
type PageEdit =
  | { type: 'text'; boundingBox: PdfRect; newText: string; fontKey: string; fontSize: number }
  | { type: 'image'; originalBoundingBox: PdfRect; newBoundingBox: PdfRect | null; imageBytes: Uint8Array; imageFormat: 'jpg' | 'png' }
  // `newBoundingBox: null` on an image edit means "deleted"

interface PdfRect { x: number; y: number; width: number; height: number }  // PDF user-space units

interface WorkspaceState {
  sourceFiles: SourceFile[]     // every file uploaded this session; append-only (no story requires removing a whole file once its pages are in the grid)
  pages: WorkingPage[]          // the ordered working set — drives the thumbnail grid, merge order, and export
}
```

Why a flat `pages` array instead of nesting pages under files: dragging a page from file B to sit between two pages of file A is then just "move one array element" — there is no special cross-file case to write. This single decision is what makes stories 1 and 4 (merge and reorder) share one component instead of needing two.

### State management

Per the constitution ("React state/context, avoid global state libraries"), `WorkspaceState` lives in a `useReducer` at the top of the feature, exposed via context so the thumbnail grid, action buttons, and download button don't need prop-drilling:

```ts
// src/features/workspace/workspaceReducer.ts
type WorkspaceAction =
  | { type: 'ADD_FILES'; files: SourceFile[] }               // appends new source files + their pages to the end of `pages`
  | { type: 'REORDER_PAGES'; fromIndex: number; toIndex: number }
  | { type: 'DELETE_PAGE'; pageId: string }
  | { type: 'ROTATE_PAGE'; pageId: string; delta: 90 | -90 }  // rotation = (rotation + delta + 360) % 360
  | { type: 'RESET' }

function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState
```

`src/features/workspace/WorkspaceContext.tsx` provides `{ state, dispatch }` via `createContext` + a `WorkspaceProvider`. No history/undo lives here yet — that's added generically in Phase 4, wrapping whatever reducer exists by then, rather than being designed in up front.

### File/module layout after Phase 1

```
src/
  lib/
    pdf.ts          (existing, unchanged)
    pdfExport.ts    (new in Phase 2 — see below)
    zip.ts          (new in Phase 6)
  features/
    workspace/                  (replaces features/viewer/)
      types.ts
      workspaceReducer.ts
      WorkspaceContext.tsx
      Workspace.tsx              (renamed from PdfViewer.tsx; top-level screen)
      UploadDropzone.tsx          (moved, generalized to multi-file)
      ThumbnailGrid.tsx           (moved, gains dnd-kit sorting)
      PageThumbnail.tsx           (moved, gains drag handle + action buttons in Phase 3)
      PagePreview.tsx             (moved, unchanged behavior)
      Spinner.tsx                 (moved, unchanged)
```

---

## Phase 1 — Multi-file upload + drag-and-drop reorder (in-memory only)

**Status:** ✅ Shipped — see `docs/diary/2026-08-20-workspace-multi-file-and-export.md`, Step 1 (commit `ca57e13`).

**Covers:** story 4 (reorder), and lays the groundwork for story 1 (merge — export comes in Phase 2).

**New dependency:** `@dnd-kit/core@^6`, `@dnd-kit/sortable@^10`, `@dnd-kit/utilities@^3` — pin to this specific, stable generation deliberately. dndkit.com's current landing docs default to a newer, differently-shaped rewrite (`@dnd-kit/react` + `@dnd-kit/dom`, using `DragDropProvider` instead of `DndContext`, no `SortableContext` wrapper, a different sensor-config shape) — don't follow those docs when implementing this phase's API calls below.

**Steps:**

1. Rename `src/features/viewer/` → `src/features/workspace/`; rename `PdfViewer.tsx` → `Workspace.tsx`; update the import in `src/App.tsx`.
2. Add `types.ts`, `workspaceReducer.ts`, `WorkspaceContext.tsx` as described above.
3. `UploadDropzone`: change `<input>` to `multiple`, and the drop handler to iterate `event.dataTransfer.files` instead of taking `[0]`. For each selected `File`, call `loadPdfDocument(file)`, build a `SourceFile` (`id: crypto.randomUUID()`), and once all files in the batch have loaded, dispatch one `ADD_FILES` action with a `SourceFile[]` plus the derived `WorkingPage[]` (one per page of each file, `sourcePageNumber` 1..`getPageCount(doc)`, `rotation: 0`, `edits: []`). A file that fails to load (not a valid PDF, corrupted, or password-protected — the last of which is out of scope per the PRD) falls through to the same generic load-error state the baseline viewer already has; no new error handling needed for that case.
4. Behavior change from iteration 1: uploading is now **additive**, not a reset. The empty-state dropzone only shows when `pages.length === 0`; once there's at least one page, show a persistent small "Add more files" control (e.g. a button in the header) that opens the same file picker and dispatches `ADD_FILES` the same way. The old "Upload a different file" action becomes "Clear all" and dispatches `RESET` (with a confirmation, since it now discards potentially-merged work from multiple files, not just one).
5. `ThumbnailGrid`: wrap in `<DndContext onDragEnd={...}><SortableContext items={pages.map(p => p.id)} strategy={rectSortingStrategy}>`. `onDragEnd`: if `active.id !== over?.id`, compute `oldIndex`/`newIndex` via `arrayMove` semantics and dispatch `REORDER_PAGES`.
6. `PageThumbnail`: becomes a `useSortable({ id: page.id })` consumer; apply the returned `transform`/`transition` as inline style and spread `listeners`/`attributes` onto the thumbnail button (or a small drag-handle icon on it, so clicking the thumbnail still just selects it — don't make the whole button a drag source if that conflicts with click-to-select; dnd-kit's `PointerSensor` with an `activationConstraint` distance threshold resolves click-vs-drag ambiguity).
7. Because `pages` is already one flat array spanning all source files, dragging a thumbnail from file B in between two thumbnails from file A "just works" as a normal array move — no cross-file special case to write.
8. `PagePreview` and the rest of the render logic carry over unchanged, just reading `pages`/`sourceFiles` from context instead of local `doc` state.

**Done when:** uploading two different PDFs pools all their pages into one grid, and pages can be freely dragged into any order, including across the two files' original boundaries — verified visually (screenshot before/after a cross-file drag), no export yet.

---

## Phase 2 — Export pipeline + non-destructive download

**Status:** ✅ Shipped — see `docs/diary/2026-08-20-workspace-multi-file-and-export.md`, Step 2 (commit `f4685d0`).

**Covers:** story 1 (merge) completed end-to-end; the PRD's "original untouched, download button produces the finished file" decision, for every later phase to reuse.

**New dependency:** `@pdfme/pdf-lib`.

**New file:** `src/lib/pdfExport.ts`

```ts
// Builds one output PDF from the current working set, in `pages` order.
async function buildPdf(sourceFiles: SourceFile[], pages: WorkingPage[]): Promise<Uint8Array>

// Triggers a browser download of already-built bytes; revokes the object URL afterward.
function downloadBytes(bytes: Uint8Array, filename: string): void
```

**Implementation details:**

1. `SourceFile` needs its raw bytes for pdf-lib (separate from the pdf.js handle used for rendering). Cache each file's `ArrayBuffer` lazily the first time it's needed (`file.arrayBuffer()`), stored alongside the `SourceFile` so a multi-page export from the same file doesn't re-read it repeatedly.
2. `buildPdf`: 
   - `const outputDoc = await PDFDocument.create()`
   - Group `pages` by `sourceFileId` in original order but preserve the overall `pages` sequence — actually copy pages one at a time in `pages` order (not grouped), since `copyPages` accepts a single source doc at a time: for each `WorkingPage`, load (or reuse a cached) `PDFDocument` for its `sourceFileId` via `PDFDocument.load(bytes)`, then `const [copied] = await outputDoc.copyPages(srcPdfLibDoc, [page.sourcePageNumber - 1])`, then `outputDoc.addPage(copied)`.
   - Cache the loaded `PDFDocument` per `sourceFileId` within one `buildPdf` call (a `Map`) so a file contributing 5 pages is only parsed by pdf-lib once, not 5 times.
   - Apply rotation: `copied.setRotation(degrees((copied.getRotation().angle + workingPage.rotation) % 360))` — additive on top of whatever rotation the original page already had, not a replacement.
   - Apply edits: after rotation, walk `workingPage.edits` in order and, for each one, draw an occluding rectangle over its `boundingBox`/`originalBoundingBox` and then draw the replacement content on top (`page.drawText(...)` for a `'text'` edit; `embedJpg`/`embedPng` + `page.drawImage(...)` for an `'image'` edit whose `newBoundingBox` isn't `null`) — see Phases 7-8 for exactly how these records are produced and what they contain. Because `buildPdf` always rebuilds from `sourceFiles`' original, untouched bytes plus whatever is currently recorded on `pages`, every call — download, extract, or split, at any point in the session — reflects the complete edit history so far. There's no separate "save" step for edits and no risk of an edit silently failing to make it into a later export, since there's only ever one export path and it always reads the current `pages` state.
   - `return outputDoc.save()`.
3. `downloadBytes`: wrap `bytes` in `new Blob([bytes], { type: 'application/pdf' })`, create an object URL, click a detached `<a download>` programmatically, then `URL.revokeObjectURL` after a tick.
4. Add a "Download" button to `Workspace.tsx`'s header (enabled whenever `pages.length > 0`), calling `buildPdf` then `downloadBytes(bytes, 'merged.pdf')`. Show a brief loading state on the button while `buildPdf` runs (it's async and not instant for larger documents).
5. Confirm non-destructiveness: nothing in this phase ever calls `.save()`/writes back to the original uploaded `File` objects — `sourceFiles` and the original bytes are only ever read from, never mutated. This is naturally satisfied by the design (pdf-lib's `PDFDocument.load` doesn't mutate its input bytes), but worth a deliberate check/test once built.

**Done when:** upload two PDFs, drag pages into a new cross-file order, click Download, and open the resulting file to confirm it contains the right pages in the right order with correct content — the first fully real, end-to-end user story.

---

## Phase 3 — Delete and rotate individual pages

**Status:** ✅ Shipped — see `docs/diary/2026-08-20-workspace-multi-file-and-export.md`, Step 3 (commit `7e030eb`).

**Covers:** story 5 (crop excluded — deferred to v2 per the PRD).

**Steps:**

1. `PageThumbnail` gains a small action overlay (visible on hover/focus, and always visible on touch devices): a rotate button and a delete button, styled to not interfere with the existing drag handle or click-to-select area.
2. Rotate button dispatches `ROTATE_PAGE` with `delta: 90`; each click rotates that page a further 90° clockwise (wrapping at 360). The thumbnail's canvas re-render must account for rotation: `renderPageToCanvas` currently renders un-rotated — extend it (or wrap it) to apply the working rotation on top of the page's own viewport rotation, e.g. `page.getViewport({ scale, rotation: (page.rotate + workingRotation) % 360 })`, so the thumbnail and the larger preview visually reflect the pending rotation before export, not just after downloading.
3. Delete button dispatches `DELETE_PAGE`; the reducer removes that page from the `pages` array. No confirmation dialog needed for a single-page delete (it's cheap to undo once Phase 4 lands; until then, keep it simple per "basic, nothing more").
4. If deleting the last remaining page empties `pages`, the view should fall back to the empty-state dropzone (same condition as Phase 1's `pages.length === 0` check) rather than showing an empty grid.

**Done when:** rotating a page updates both its thumbnail and (if selected) its larger preview immediately, deleting a page removes it from the grid immediately, and downloading afterward produces a PDF with the deleted page absent and the rotated page's content actually rotated in the output file (not just visually rotated in-browser).

---

## Phase 4 — Basic undo/redo

**Status:** ✅ Shipped — see `docs/diary/2026-08-20-workspace-multi-file-and-export.md`, Step 4.

**Covers:** story 8. Explicitly basic only, per the PRD ("nothing more than that... later part" for deeper history) — this is a flat past/future stack of full `pages` snapshots, not a command pattern with per-action inverses.

**Steps:**

1. Add a small generic wrapper, not specific to this reducer, so it stays simple:
   ```ts
   // src/features/workspace/useHistoryReducer.ts
   function useHistoryReducer<S, A>(reducer: (s: S, a: A) => S, initial: S) {
     // wraps useReducer with { past: S[]; present: S; future: S[] }
     // dispatch(action) pushes `present` onto `past`, clears `future`, computes new `present`
     // undo() / redo() move one snapshot between past/present/future
     // returns { state: present, dispatch, undo, redo, canUndo, canRedo }
   }
   ```
2. Apply it only to the `pages` slice of `WorkspaceState` — `sourceFiles` stays outside history (uploading more files is additive and isn't something users asked to "undo"; undoing back past a file being added would orphan pages referencing it, which adds real complexity for a case the PRD doesn't ask for).
3. `REORDER_PAGES`, `DELETE_PAGE`, and `ROTATE_PAGE` all become "undoable" for free by virtue of going through the wrapped reducer; `ADD_FILES` also passes through it (so undo can remove a just-added batch of pages) but `RESET` bypasses history (it's a hard reset, not something to step back from). The same is true for whatever comes later: Phase 7's `APPLY_TEXT_EDIT` and Phase 8's `APPLY_IMAGE_EDIT` both work by appending to a `WorkingPage`'s `edits` array, which is part of the same `pages` slice this wrapper already covers — so text and image edits become undoable the moment those actions exist, with no changes needed here or in those later phases.
4. Add Undo/Redo buttons to `Workspace.tsx`'s header (disabled via `canUndo`/`canRedo`), plus keyboard shortcuts (`Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`) via a `useEffect` keydown listener scoped to the workspace screen.

**Done when:** dragging a page, deleting a page, and rotating a page can each be undone (and redone) via both the buttons and the keyboard shortcuts, verified by reordering, undoing back to the original order, and confirming the grid visually matches the pre-drag state.

---

## Phase 5 — Extract one or more pages into their own PDF

**Status:** ✅ Shipped — see `docs/diary/2026-08-20-workspace-multi-file-and-export.md`, Step 5.

**Covers:** story 2.

**Steps:**

1. Add a selection mode to the thumbnail grid: a checkbox (or shift/cmd-click, kept simple as a checkbox for v1) on each `PageThumbnail`, tracked as local UI state in `Workspace.tsx` (`selectedPageIds: Set<string>`) — this is transient UI state, not part of `WorkspaceState`/history, since selection isn't something users need to undo.
2. When one or more pages are selected, show an "Extract selected" action (alongside the main Download button) that calls `buildPdf(sourceFiles, pages.filter(p => selectedPageIds.has(p.id)))` — reusing Phase 2's export pipeline unchanged, just with a filtered subset in the current grid order — then `downloadBytes(bytes, 'extracted.pdf')`.
3. Extracting does not remove the pages from the working set (this is a copy-out operation, distinct from Delete in Phase 3).

**Done when:** selecting pages 2 and 4 out of a 5-page working set and clicking "Extract selected" downloads a 2-page PDF containing exactly those pages in their current relative order, while the main workspace grid still shows all 5.

---

## Phase 6 — Split into multiple files at page ranges (zipped)

**Status:** ✅ Shipped — see `docs/diary/2026-08-20-workspace-multi-file-and-export.md`, Step 6.

**Covers:** story 3, including the "delivered as one zip download" decision.

**New dependency:** `client-zip`.

**New file:** `src/lib/zip.ts`

```ts
// Bundles multiple named PDF byte arrays into one zip Blob for download.
async function zipPdfs(parts: { name: string; bytes: Uint8Array }[]): Promise<Blob>
```
Implemented via `client-zip`'s `downloadZip(parts.map(p => ({ name: p.name, input: p.bytes }))).blob()`. `client-zip` stores rather than compresses by default, which is correct here since PDF bytes are already binary/incompressible.

**Steps:**

1. Add a "Split" mode to the workspace, reusing the same thumbnail grid: instead of (or alongside) per-page selection, let the user mark split points between pages — e.g. a small "insert split here" affordance in the gap between adjacent thumbnails, toggled per gap. This is simplest to model as a `Set<number>` of gap-indices (a split after position `i` in the current `pages` order).
2. Given the current `pages` order and a set of split-gap indices, partition `pages` into contiguous groups (`splitIntoRanges(pages, sortedGapIndices): WorkingPage[][]`, a pure function in `pdfExport.ts` — no page-order or content changes, purely a slicing operation).
3. For each group, call `buildPdf(sourceFiles, group)` (Phase 2's function, unchanged) to get that part's bytes; name each part predictably (e.g. `part-1.pdf`, `part-2.pdf`, or reuse the first page's original source filename if that reads better — decide during implementation based on what looks clearest in the zip).
4. Pass all parts to `zipPdfs`, then reuse a generalized `downloadBytes`-style helper for a `Blob` (rather than raw bytes) to trigger the zip's download as e.g. `split-output.zip`.
5. Single-page extraction (story 2, Phase 5) and multi-way split (this phase) end up sharing nearly all of their machinery (`buildPdf` on a subset/partition of `pages`) — the only real difference is selection-by-checkbox vs. partition-by-gap, and single-file-vs-zip output when there's more than one resulting part.

**Done when:** marking two split points in a 6-page working set and clicking "Split" downloads a zip containing 3 correctly-partitioned PDFs, each opening to show the right, correctly-ordered pages.

---

## Phase 7 — In-place text editing with local-block reflow

**Status:** ✅ Shipped — see `docs/diary/2026-08-20-workspace-multi-file-and-export.md`, Step 7. User confirmed the occlusion caveat below and chose to surface it in-app (a dismissible disclosure shown when text-edit mode is entered).

**Covers:** story 6. This is the hardest, least mechanical phase — per `CONSTITUTION.md`, no off-the-shelf library does true in-place PDF text editing, so this phase implements the overlay/occlusion approach the constitution already commits to, and its design should be treated as a first attempt to validate, not a fixed spec.

**Important caveat to confirm with the user before or during this phase, not after:** neither pdf-lib nor any other client-side library can truly delete or rewrite existing text operators in a PDF's content stream. The only pdf-lib-native way to "remove" the original text is to draw an opaque rectangle over it and draw new text on top — the original glyphs remain physically present in the file underneath that rectangle (recoverable by anyone who inspects the raw content stream or copy-pastes with certain tools, even though nothing is visible on screen). This is a real, product-relevant limitation for an "editor" and should be surfaced explicitly rather than discovered later — worth a short check-in with the user once this phase starts, not something to silently ship.

**Steps:**

1. On selecting a page for editing, call pdf.js's `page.getTextContent()` to get `TextItem[]` (each with `str`, a 6-element `transform` matrix, `width`, `height`, `fontName`).
2. Cluster items into logical lines (group items whose baseline Y — `transform[5]` — falls within a small epsilon of each other) and then lines into blocks/paragraphs (group adjacent lines whose vertical gap is below a threshold and whose left edges roughly align). This is a heuristic, not a PDF-spec concept — expect to tune the thresholds against real sample documents rather than get them right analytically upfront.
3. Render an absolutely-positioned HTML layer on top of the page canvas, one element per detected block, positioned by converting each block's PDF-space bounding box into on-screen CSS pixels using the same viewport/scale transform `renderPageToCanvas` already uses. Each block becomes a `contentEditable` element (or a styled `<textarea>`) showing that block's text, sized to the block's box so the browser's own text-wrapping shows the user how it reflows live as they type — this is what actually delivers "reflow" (it's the browser doing it, not the PDF).
4. On committing an edit to a block (blur, or an explicit "apply" step), dispatch an `APPLY_TEXT_EDIT` action that appends one `PageEdit` — `{ type: 'text', boundingBox, newText, fontKey, fontSize }` — to that page's `edits` array. This step touches no pdf-lib document at all: `boundingBox` comes from the same PDF-coordinate conversion used to position step 3's overlay, and `fontKey`/`fontSize` are resolved from the original `TextItem.fontName` (see the font-matching note below). Because this is just a reducer action on `pages`, it's automatically covered by Phase 4's undo/redo once that phase exists, exactly like rotation is.
5. The actual drawing happens later, inside `buildPdf` (Phase 2's updated step): for a `'text'` edit, draw a white (or sampled-background-color) rectangle over `boundingBox` via `page.drawRectangle(...)` to visually occlude the original text, then draw `newText` via `page.drawText(...)`, hard-wrapped to the box's width using `font.widthOfTextAtSize()` for line-breaking. Deferring the actual pdf-lib drawing to build-time (rather than doing it live against some document held open during editing) is what lets every download/extract/split call — at any point in the session — reflect the full, current set of edits, with no separate save/reload cycle to keep in sync.
6. **Font matching, v1 simplification:** true font reuse would mean extracting the original embedded font program's bytes from the page's font resource dictionary and re-embedding it via pdf-lib's low-level font-embedding API — real work, not a quick lookup. For v1, use a naive heuristic instead: map the original `TextItem.fontName` string to the closest pdf-lib `StandardFonts` entry (e.g. a name containing "Bold" and "Italic" → `HelveticaBoldOblique`, otherwise `Helvetica`/`TimesRoman` based on serif hints in the name). This means edited text may not visually match the surrounding original text's exact typeface — an explicit, known v1 limitation, not a bug to chase down here.
7. Reflow scope stays exactly what the PRD confirmed: contained to the edited block's own box. If the new text is longer than the original block's height, decide (during implementation, informed by trying it against a real document) whether to grow the occlusion+redraw box downward or clip — this wasn't pinned down at the PRD level beyond "confined to the local block," so treat the exact overflow behavior as an implementation-time decision, not a re-litigated requirement.

**Done when:** opening a page, editing a sentence inside one paragraph (including making it longer), and downloading shows the edited text in place, wrapped within its original block, with the rest of the page unchanged — reviewed against a real multi-paragraph sample document, and the occlusion caveat above has been explicitly surfaced to the user.

---

## Phase 8 — Move, resize, or delete existing images

**Covers:** story 7. Also genuinely hard, for a similar reason to Phase 7: pdf-lib's public API has no way to enumerate or manipulate an image XObject that's already on a page (confirmed during the Phase 0 research — see the constitution and diary). Uses the same edits-as-data and occlude-then-redraw pattern established in Phase 7, rather than trying to surgically rewrite the original content stream in place — pdf-lib's public API supports writing new drawing operations onto a page well, but does not expose a parsed, walkable list of a page's *existing* operators to edit, so "rewrite the `cm` matrix in place" isn't actually achievable through supported API surface (an earlier draft of this plan assumed otherwise; corrected here).

### Step 1 — Image detection + static overlay (validation only)

**Status:** ✅ Shipped — see `docs/diary/2026-08-21-image-detection-validation.md`.

1. Detect existing images and their current on-page position/size using pdf.js's `getOperatorList()` on the already-loaded page (the app depends on pdf.js already; this reuses it rather than reaching for pdf-lib's low-level internals) — walk the returned `fnArray`/`argsArray`, tracking the accumulated transform matrix through `OPS.save`/`OPS.transform`/`OPS.restore`, and record the matrix in effect at each `OPS.paintImageXObject` call to derive that image's position and size in PDF coordinates. Treat this detection step as the first thing to validate against a handful of real sample PDFs with images placed different ways (rotated, scaled, inside nested save/restore groups) before building anything interactive on top of it — it's the riskiest, least-proven part of this phase. If `getOperatorList()` doesn't expose enough to reconstruct a given image's placement reliably, the fallback is a hand-rolled tokenizer over the page's raw, decoded content stream bytes (`page.node.Contents()` + pdf-lib's `decodePDFRawStream`) — real work, not a ready-made primitive, so only reach for it if the pdf.js-based approach genuinely falls short.
2. Render a **read-only** bounding-box overlay per detected image atop the page canvas (same coordinate-conversion mechanism as Phase 7's per-block overlay), toggled by a "Show images"/"Hide images" button in the preview panel, with no drag/resize/delete interaction yet — this step exists purely to prove detection is accurate before any editing UI is built on top of it.

**Done when:** an existing image on a real sample page is correctly detected with its actual position/size, verified by drawing the detected overlay box directly on top of the rendered page and confirming visually (and numerically, against hand-computed expected coordinates) that it lines up with the real image — including under nested `save`/`transform`/`restore` groups and under a working-session page rotation.

### Step 2a — Interactive move/resize/delete (visual only, no export wiring)

**Status:** ✅ Shipped — see `docs/diary/2026-08-21-image-interaction-ui.md`.

1. Upgrade Step 1's read-only overlay box into a selectable/draggable one (same mechanism, now with drag-to-move, a corner handle for resize, and a delete action).
2. Deliberately deferred to Step 2b: no `APPLY_IMAGE_EDIT` reducer action yet, and box geometry/deletion live only in local, screen-space component state — discarded on unmount (i.e. on toggling "Hide images" then "Show images" again), not reflected in `buildPdf`/the downloaded PDF, and not covered by undo/redo. This mirrors the plan's own Step 1/Step 2 split for detection: prove the interaction feels right in isolation before wiring it into the PDF-space edit-recording and export-time redraw machinery.

**Done when:** a detected image can be dragged to a new position and resized via a corner handle, and a delete (×) button visually removes its box — verified interactively (drag/resize/delete each produce the expected screen-space geometry change, with no console errors), with no expectation yet that any of this affects the exported PDF.

### Step 2b — Wire interaction into `APPLY_IMAGE_EDIT` + `buildPdf`

**Status:** ✅ Shipped — see `docs/diary/2026-08-21-wire-image-edits-into-export.md`. Also moved image editing into its own full-screen `ImageEditDialog` (mirroring the text-edit dialog from `docs/diary/2026-08-21-image-overlay-fixes-and-text-edit-sizing.md`), completing every user story in `PRD.md`.

1. On commit (drag/resize release, or delete), dispatches an `APPLY_IMAGE_EDIT` action with one `PageEdit` — `{ type: 'image', originalBoundingBox, newBoundingBox, imageBytes, imageFormat }` (`newBoundingBox: null` for a delete). **Deviation from the original plan:** `imageBytes` are captured by cropping the region's pixels out of the already-rendered page canvas (`cropRegionToPng` in `src/lib/imageRegions.ts`) rather than reading the page's `XObject` resource dictionary directly — a raw XObject stream's bytes aren't necessarily valid standalone JPEG/PNG file bytes on their own (depends on its filter/color space), so the canvas crop always yields a clean, self-contained PNG at the cost of re-rasterizing at the dialog's render resolution rather than the image's native one. `imageFormat` is therefore always `'png'` in practice (`'jpg'` stays supported in `buildPdf` for the type's sake, unused by this capture path). The reducer upserts by `originalBoundingBox` equality rather than always appending, so repeated interactions with the same image (drag, then resize) replace one edit in place instead of stacking edits that would otherwise both try to draw the image and duplicate it in the output.
2. `buildPdf`'s `applyImageEdit` draws an occluding rectangle over `originalBoundingBox`, then — unless `newBoundingBox` is `null` — embeds the captured PNG and draws it at the new position/size. Carries the same caveat as Phase 7's text edits (now one shared, generalized disclosure banner covering both dialogs): the original image's bytes remain physically present in the page's content stream underneath the occluding rectangle, not truly removed.

**Done when:** a detected image can be dragged to a new position and resized, the change is reflected in the downloaded PDF, and a delete visually removes it from the output without corrupting the rest of the page's content. Verified against a real download: dragging and resizing produced exactly the expected PDF-space position/size deltas (checked numerically via pdf.js's `getOperatorList`, not just visually), a delete occluded without redrawing, and undo/redo correctly restored a deleted image — for free, via the same `pages`-slice history wrapper Phase 4 already provides.

---

## Summary of new dependencies by phase

| Phase | New dependency | Purpose |
|---|---|---|
| 1 | `@dnd-kit/core@^6`, `@dnd-kit/sortable@^10`, `@dnd-kit/utilities@^3` (the stable "legacy"-generation packages, not the newer `@dnd-kit/react`/`@dnd-kit/dom` rewrite) | drag-and-drop page reordering |
| 2 | `@pdfme/pdf-lib` | building/exporting output PDFs |
| 6 | `client-zip` | bundling split output into one download |
| 7, 8 | *(none new — both reuse pdf.js + pdf-lib already installed)* | text/image editing overlays |
