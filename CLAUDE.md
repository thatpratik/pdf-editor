# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A client-side-only PDF editor (merge, split, reorder, delete/rotate pages, in-place text editing, image move/resize/delete, undo/redo, light/dark theme). Files never leave the browser — no server upload, ever, in any feature. See `README.md` for the user-facing feature list, `PRD.md` for the product spec (including what's explicitly out of scope), `CONSTITUTION.md` for architecture/tech-stack constraints, and `IMPLEMENTATION_PLAN.md` for how each phase was actually built (including deviations from the original plan).

## Commands

```bash
npm run dev       # start the Vite dev server
npm run build     # tsc -b && vite build — type-check first, then bundle
npm run preview   # preview the production build locally
npm run lint       # eslint .
npm run format     # prettier --write .
```

There is no test suite/runner configured in this repo — don't assume one exists.

## Architecture

### Data model: one flat `pages` array drives everything

`src/features/workspace/types.ts` defines the core model:

- `SourceFile` — one uploaded PDF (id, name, the raw `File`, and a pdf.js `PDFDocumentProxy` used only for rendering).
- `WorkingPage` — one page in the working set: `sourceFileId` + `sourcePageNumber` (which never changes) + `rotation` + `edits: PageEdit[]`. Its own `id` is stable across reorders (React key, dnd-kit sortable id).
- `WorkspaceState` = `{ sourceFiles: SourceFile[]; pages: WorkingPage[] }`.

`pages` is a single flat array spanning **every** uploaded file, not pages nested under files. This is the one decision that makes merge (dragging a page from file B between two pages of file A) and single-file reorder the same operation — a plain array move, no cross-file special case anywhere in the codebase.

### Edits are data, applied at export time — not live document mutations

A `PageEdit` (`{ type: 'text', boundingBox, newText, fontKey, fontSize }` or `{ type: 'image', originalBoundingBox, newBoundingBox, imageBytes, imageFormat }`) is just a record appended to a `WorkingPage.edits` array when the user finishes editing a block/image. Nothing touches a pdf-lib document at that point.

The actual drawing happens inside `buildPdf` (`src/lib/pdfExport.ts`), which is called fresh every time — Download, Extract, and Split all call it with whatever subset/order of `pages` they need. For each edit it draws an opaque rectangle over the original spot and redraws the replacement on top. Because of this:

- The original uploaded bytes are **never** mutated — `buildPdf` always starts from `sourceFile.file.arrayBuffer()` (cached per file in `pdfExport.ts`'s `rawBytesCache`) and layers the current `pages` state on top.
- There's no separate "save" step and no way for an edit to be silently dropped from an export.
- The original content is only visually covered, not removed from the PDF's content stream — this is a real, disclosed limitation (see the in-app caveat banner in `TextEditDialog`/`ImageEditDialog`), not an oversight.

### State: `sourceFiles` is plain state, `pages` is wrapped in undo/redo history

`WorkspaceContext.tsx` splits `WorkspaceState` into two independently-managed pieces and re-merges them behind one `dispatch`:

- `sourceFiles` — plain `useState`, append-only. Uploading more files isn't something users undo.
- `pages` — run through `useHistoryReducer` (`useHistoryReducer.ts`), a generic `{ past, present, future }` wrapper around any `(state, action) => state` reducer. `workspaceReducer.ts`'s `pagesReducer` is the reducer it wraps.

Because undo/redo wraps the reducer generically, every action that goes through it (reorder, delete, rotate, and both `APPLY_*_EDIT` actions) is undoable for free — there's no per-action inverse logic to maintain. `RESET` (Clear all) bypasses history on purpose; it's a hard reset, not a step to undo back through.

`useWorkspace()` (`useWorkspace.ts`) is the hook everything else calls to get `{ state, dispatch, undo, redo, canUndo, canRedo }` — never reach into `WorkspaceContext` directly.

### Detecting text/images on a page (heuristic, not a PDF-spec concept)

- `src/lib/textBlocks.ts` (`getTextBlocks`) clusters pdf.js's flat `TextContent.items` into lines (shared baseline) and lines into paragraph-like blocks (small vertical gap, aligned left edge, similar font size, and the previous line looking "wrapped" rather than short-and-complete). The thresholds are tuned against sample documents, not derived analytically — expect to retune if a real document behaves oddly.
- `src/lib/imageRegions.ts` (`getPageImageRegions`) walks pdf.js's `getOperatorList()`, tracking the CTM through `save`/`transform`/`restore` to compute each `paintImageXObject`'s on-page bounding box. It only recognizes external image XObjects, not inline images or images nested in Form XObjects.
- Editing an image doesn't read the PDF's raw image bytes back out (pdf-lib has no supported API for that, and a raw stream's bytes aren't necessarily a valid standalone image file anyway). Instead `cropRegionToPng` in `imageRegions.ts` crops the pixels straight out of the already-rendered `<canvas>` — so captured image edits are always PNG, re-rasterized at the dialog's render resolution rather than the original's native resolution.

### pdf.js integration lives entirely in `src/lib/pdf.ts`

Everything that needs pdf.js should import from `src/lib/pdf.ts`, not `pdfjs-dist` directly — it's the only place that configures the worker (`GlobalWorkerOptions.workerSrc`, wired to Vite's `?url` import so the worker file gets bundled/hashed correctly) and it patches pdf.js 6.x's `getDocument()` result so `.destroy()` lives on the resolved `PDFDocumentProxy` itself (in 6.x it only exists on the loading task, which is easy to lose track of and leak).

### Theming: CSS variables, not Tailwind `dark:` classes

`src/index.css` defines all color tokens as CSS custom properties on `:root`, overridden under `:root[data-theme='dark']`, then mapped into Tailwind's `@theme` (e.g. `--color-accent: var(--accent)`). Every `bg-*`/`text-*`/`border-*` utility using these tokens therefore repaints automatically when `document.documentElement.dataset.theme` flips — `ThemeToggle.tsx` just toggles that one attribute and persists the choice to `localStorage`; no `dark:` variants scattered through components. An inline script in `index.html` sets the attribute before first paint to avoid a flash of the wrong theme.

Functional colors (`accent`, `teal`, `danger`) each have a `-fill` variant for solid button backgrounds (paired with white text) separate from the bare token used for text/icon/border roles — the bare token is tuned to read clearly against the page background in both themes, which isn't always the same shade needed for a filled button to keep white text at good contrast, especially in dark mode.

### Module layout

```
src/lib/            framework-agnostic: pdf.js wrapper, pdf-lib export/split pipeline,
                     zip bundling, text-block/image-region detection — no React here
src/features/workspace/
                     the entire app: Workspace.tsx is the top-level screen;
                     WorkspaceContext/useWorkspace/workspaceReducer/useHistoryReducer
                     are the state layer; everything else is a component
```

`docs/diary/` has a dated, written account of how each feature was actually built, including dead ends and deviations from `IMPLEMENTATION_PLAN.md` — check it before assuming the plan doc alone reflects reality for image editing, which changed shape during implementation (e.g. the image-bytes-capture approach).
