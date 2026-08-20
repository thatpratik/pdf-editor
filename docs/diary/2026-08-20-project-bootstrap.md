# Diary: Bootstrapping the client-side PDF editor (PRD → constitution → first working iteration)

Goal for this stretch of work: take an already-started PRD from vague to specific, lock in the tech stack (including a couple of decisions the user was genuinely unsure about), and ship the first real, browser-verified slice of the app — an upload-and-view flow proving the pdf.js rendering pipeline works — before any editing features get built.

## Step 1: Refine PRD.md

**Author:** main

### Prompt Context

**Verbatim prompt:** "Already added that I want to refine it read @PRD.md"
**Interpretation:** The user already had a draft `PRD.md` in the repo and wanted it sharpened via a clarifying interview, not rewritten from scratch.
**Inferred intent:** Get the product scope concrete enough that the constitution and implementation could proceed without guessing at ambiguous behavior.

### What I did

Read the existing `PRD.md` and, following the project's `clarify-prd` skill, asked one focused question at a time rather than dumping a checklist: how the user gets a finished file out of the tool (download button, non-destructive — original stays untouched), whether undo/redo belongs in v1 (yes, basic only), how far "text reflow" should go (deferred the full-page-cascade question to me, scoped to local-block-only reflow for v1), what "crop" actually means (this one turned into a real correction — see below), whether v1 allows adding brand-new content (new text within existing blocks yes, new freestanding text boxes/images no), how multi-file merge ordering works (one unified thumbnail drag-and-drop grid handles both merge-ordering across files and single-file reordering), and how a multi-file split should be delivered (zipped into one download). After each answer I updated my mental model, then wrote the full revised `PRD.md` only after summarizing every change and getting explicit approval.

### Why

The original PRD's Implementation Decisions section already asserted some specifics (e.g. "full reflow... word-processor-style") without the underlying behavior actually being pinned down, and several whole areas (export flow, undo, crop, new-content policy, merge UI, split packaging) were unaddressed. Per the `clarify-prd` skill, none of this should be invented — it has to come from the user.

### What worked

Asking one question at a time surfaced a real misunderstanding early: when asked what "crop" should mean, the user described selecting page 2 out of a 10-page document into its own file — which is actually the already-specified "extract" story (story 2), not crop (trimming a page's visible boundary) at all. Stopping to describe both concepts back to the user, rather than assuming which one they meant, caught a genuine terminology conflict before it got written into the document. The user then simply deferred crop to v2 outright, which resolved it cleanly.

### What didn't work

Nothing failed outright. The one soft miss was that my first framing of the crop question didn't anticipate the user might have "extract" in mind — worth remembering that "crop" is genuinely overloaded in PDF-tool contexts and should probably be asked with the contrast to "extract" spelled out up front next time.

### What I learned

For this small-team, non-public tool, the user is comfortable explicitly delegating scoping calls to me ("I'll leave this to you," "whatever you feel is best") as long as I state the tradeoff and where the deferred decision goes (v2). That's a real signal for how to run future clarification passes on this project: propose a concrete default rather than re-asking when the user hands back the decision.

### What was tricky

Keeping the PRD honestly scoped once the user started allowing "add new text" — the natural next question ("does that mean new text boxes too, or new images?") mattered because the PRD template forbids inventing/padding beyond what's confirmed, so I had to keep narrowing rather than assume the broadest reading of "add new content."

### What warrants review

`/PRD.md`'s Implementation Decisions and Out of Scope sections — specifically that story 5 no longer includes crop (delete + rotate only) and that text-edit reflow is explicitly scoped to the local block, not the whole page. These are the two decisions most likely to surprise someone skimming the file who remembers the original, vaguer draft.

### Future work

The PRD's own Further Notes section now carries the v2 open questions: whether text reflow should eventually cascade page-wide, actual crop behavior, and deeper multi-step undo/redo. Nothing to add beyond what's already written there.

## Step 2: Refine CONSTITUTION.md with research-backed stack decisions

**Author:** main

### Prompt Context

**Verbatim prompt:** "/clarify-constitution" (args: "once again")
**Interpretation:** A `CONSTITUTION.md` already existed (TypeScript on Next.js/React, written in an earlier session) but the user wanted it revisited now that the PRD was much more specific, rather than assumed still correct.
**Inferred intent:** Confirm or correct the stack choice and close the one glaring gap — no PDF manipulation library had ever been named, even though nearly every PRD story depends on one.

### What I did

Read the existing constitution and asked directly whether TypeScript + Next.js/React should still stand, and separately flagged the missing PDF-library decision. The user said they'd keep TypeScript but were open to reconsidering the framework (mentioning Python, Angular) and explicitly didn't know which PDF library to pick. Given that this was a real research question rather than a stylistic one, I launched a 6-agent parallel research `Workflow` covering: pdf.js (rendering/thumbnails), pdf-lib (page manipulation), mupdf.js (the heavier alternative), the specific feasibility of client-side in-place text-reflow editing, zip-bundling libraries, and a three-way framework comparison (Next.js vs. Angular vs. plain Vite+React) tailored to this app's actual shape (client-only, single-page, no backend). I synthesized the six reports into one recommendation — Vite+React (not Next.js, not Angular), pdf.js paired with the actively-maintained `@pdfme/pdf-lib` fork (not the stale original `pdf-lib` package, not AGPL-licensed mupdf.js), `client-zip` (not JSZip), and `dnd-kit` for drag-and-drop — presented it for approval, then wrote the updated `CONSTITUTION.md`.

### Why

A constitution is supposed to lock in decisions that don't change mid-project; shipping code against an unresolved "which PDF library" question, or against a framework choice (Next.js) that no longer fit the now-clarified all-client-side, single-page scope, would have meant rework later.

### What worked

Fanning the research out to six independent agents surfaced concrete, checkable facts fast instead of relying on general knowledge that might be stale: one agent actually downloaded `mupdf-wasm.wasm` from unpkg and measured it at ~10.4MB (vs. pdf-lib's ~1MB) rather than trusting a blog post's claim; another found via npm registry metadata that MuPDF's package is genuinely `AGPL-3.0-or-later`, not just "open source"; another discovered that the canonical `pdf-lib` npm package hasn't shipped a release since November 2021 (there's a maintained fork under `@pdfme/pdf-lib` instead) — a fact that would have been easy to miss just reading the README's star count.

### What didn't work

Nothing failed technically, but the research honestly surfaced an unresolved area rather than a clean answer: whether AGPL's network-copyleft clause applies to a purely client-side WASM app is described in the research as "generally argued" not to trigger, but explicitly "not judicially settled." I reported that as a caveat rather than smoothing it into false certainty, which directly fed the decision to avoid mupdf.js altogether given a permissively-licensed alternative (pdf-lib) covers the same ground for this project's needs.

### What I learned

The core technical risk flagged in the very first (pre-research) draft of the constitution — "no off-the-shelf client-side solution exists for full in-place text reflow" — held up under actual research rather than being an assumption. What the research added was a concrete fallback shape for that eventual feature: overlay an editable layer on pdf.js's extracted text positions, redact the original glyphs in that region, then regenerate just that block's content stream via pdf-lib. That's now written into the constitution as the intended approach, still deferred until the feature is actually built.

### What was tricky

Untangling pdf-lib's maintenance status took real digging: the original `Hopding/pdf-lib` repo isn't archived but has had no commits since July 2024 and no npm release since 2021; a fork of it (`pdfme/pdf-lib`) is itself archived with a note that development moved again into the `pdfme/pdfme` monorepo, which is what's actually active today. Surface-level signals (star count, "not archived") would have pointed the wrong way.

### What warrants review

`CONSTITUTION.md`'s Fixed Dependencies list — swapping Next.js for Vite is a reversal of what an earlier session had decided, so anyone expecting Next.js conventions should notice this. Also worth a second look: the Architecture Principles note committing to the overlay/redact/regenerate approach for text and image editing, since that's a real design bet, not just a library pick.

### Future work

None new — the constitution explicitly defers the detailed design of in-place text/image editing until that feature is actively built, which is unchanged from before the research pass.

## Step 3: Build and verify iteration 1 — upload & thumbnail viewer

**Author:** main

### Prompt Context

**Verbatim prompt:** "1"
**Interpretation:** After running `/suggest-next-iteration` and proposing three options (view-only upload+thumbnails, a full single-file edit loop, or a multi-file merge slice), the user picked the smallest one: just prove the rendering pipeline works.
**Inferred intent:** De-risk the least-familiar piece (pdf.js integration in a fresh Vite app) with the smallest possible visual slice before investing in any editing interaction on top of it.

### What I did

Ran a 4-phase `Workflow` (Scaffold → PDF Library → UI → Verify), where each stage's subagent built on the real filesystem state left by the previous one rather than just passed-along text:

- **Scaffold**: set up Vite+React+TS, Tailwind, ESLint+Prettier, and `pdfjs-dist`, including a working web worker configuration (`pdfjs-dist/build/pdf.worker.mjs?url`, resolved by Vite in both dev and production builds) — verified with a temporary Playwright smoke test that was removed afterward, and a feature-based `src/features/`/`src/lib/` folder layout per the constitution.
- **PDF Library**: found `src/lib/pdf.ts` already matched the requested API (load a document, get page count, render a page to canvas with a cancellable handle) and just verified it compiled and lint-passed cleanly.
- **UI**: built `src/features/viewer/` — `UploadDropzone`, `ThumbnailGrid`/`PageThumbnail`, `PagePreview`, and `Spinner` — wired for a single-file upload, thumbnail grid, and larger preview on selection, with loading and error states. This agent's turn errored out with `API Error: Your computer went to sleep mid-response` after ~340s, but its file writes had already landed on disk (confirmed by `find src -type f` and reading each file afterward), so nothing was actually lost.
- **Verify**: ran `npm run build`/`lint`/`tsc --noEmit`, and caught two real bugs beyond what any static check alone would show: `src/App.tsx` was still rendering the placeholder scaffold screen and never mounted `PdfViewer` (the whole feature was dead code until this was fixed), and `PDFDocumentProxy.destroy()` doesn't exist on pdf.js 6.x's resolved document object — only the pre-resolution `PDFDocumentLoadingTask` has it — so every cleanup call (`docRef.current?.destroy()`) would have thrown/no-opped and silently leaked the worker-side document on every file swap. Fixed by having `loadPdfDocument` keep the loading task alive in closure and attach a working `destroy()` onto the resolved proxy.

After the workflow, I personally read through every file it touched (`App.tsx`, `src/lib/pdf.ts`, and all of `src/features/viewer/`) rather than trusting the agents' self-reports, then verified the running app in an actual browser: `chromium-cli` (the tool the project's `run` skill recommends by default) wasn't available in this environment, so I installed Playwright into a scratch npm project under the job's tmp directory (not the app's own `package.json`, to keep test tooling out of the shipped dependencies), generated a real 3-page PDF test fixture with macOS's `cupsfilter` (since `textutil -convert pdf` doesn't exist on this macOS version), and drove the running `npm run dev` server end to end: empty state → upload → thumbnail grid renders real page content → clicking a thumbnail updates the larger preview to the right page → "upload a different file" resets cleanly → uploading a non-PDF file shows the error state. All five steps were confirmed by reading the actual screenshots, not just by selector matches, and the console had zero errors throughout.

### Why

The system's own standing instruction is that UI changes need to be exercised in a real browser before being called done — a clean type-check doesn't prove a canvas actually renders a page. The project's `suggest-next-iteration` skill also explicitly calls for "something visual running" as the bar for a first iteration, not just passing tests.

### What worked

Chaining the workflow stages so each one operates on the real repo state (not a summary of it) meant the verify stage could catch integration bugs that no single isolated stage would have seen on its own — the disconnected `App.tsx` and the `destroy()` bug were both the kind of thing that only shows up once you look at the whole assembled app.

### What didn't work

The `ui` workflow agent's turn errored with:
```
API Error: Your computer went to sleep mid-response. The response above may be incomplete.
```
— a host-level interruption (the machine slept), not a code or prompt problem. It formally counted as an "error" state in the workflow, returning `null` as its result, which would have been easy to misread as "nothing was built." Only checking the filesystem directly (`git status --short`, `find src -type f`, reading each component) showed the feature was fully written and just needed the wiring fix the next stage applied.

Separately, three small environment mismatches showed up while setting up manual browser verification:
- `chromium-cli` wasn't installed (`which chromium-cli` → not found), so I fell back to a plain Playwright script per the `run` skill's documented fallback path.
- `npx playwright install chromium --with-deps` printed a warning about running install without first installing project dependencies — harmless here since the Chromium binary was already cached from a prior install (`~/Library/Caches/ms-playwright/chromium-1234`), but worth noting for a truly clean environment.
- The GNU `timeout` command doesn't exist on this macOS shell (`(eval):1: command not found: timeout`), so my first polling one-liner for "wait until the dev server responds" silently no-op'd; the server had already started by the time I checked, so it didn't block progress, but the command itself didn't do what it looked like it did.

### What I learned

`chromium-cli` — the tool the `run` skill reaches for first — isn't guaranteed to exist even in an environment that otherwise has Node and a cached Playwright Chromium install; installing `playwright` directly into a scratch npm project under the job's own tmp directory is a clean fallback that verifies the real running app without adding test-only dependencies to the shipped project. Also: macOS's `cupsfilter` (a CUPS printing filter, not a PDF-specific tool) will happily turn a plain text file into a genuine multi-page PDF, which turned out to be a fast way to get a real, valid, multi-page test fixture without needing any PDF-authoring library installed.

### What was tricky

Treating the workflow's own summary skeptically was the crux of this step — the `ui` agent formally "failed," and it would have been reasonable to assume its work needed redoing from scratch. The actual signal that it hadn't was buried in the workflow's progress metadata (`lastToolName: "Write"`, pointing at `PdfViewer.tsx`), which only becomes trustworthy once cross-checked against the real filesystem rather than taken as an assertion.

### What warrants review

`/src/lib/pdf.ts`'s `destroy()`-patching approach — attaching a closure-based `destroy` onto the resolved `PDFDocumentProxy` so existing call sites keep working — is exactly the kind of resource-lifecycle code worth a second pair of eyes. So is `/src/features/viewer/PdfViewer.tsx`'s load-token/ref guard against a stale file load resolving after a newer one was picked. Also worth confirming independently: nothing from this session was committed to git (`git status --short` shows everything as untracked `??` entries), consistent with only committing when the user explicitly asks.

### Future work

Per the project's own `suggest-next-iteration` skill, deciding what comes after this iteration isn't this session's call — that happens when the user runs `/suggest-next-iteration` again in a fresh session, after this diary entry.
