# Diary: Fix known Phase 8 Step 2a issues; enlarge the text-edit box

Goal: run `/suggest-next-iteration` for a fresh session, pick a scoped next
step from the options offered, then also fold in two ad hoc UX fixes the user
asked for mid-turn once they saw the text-edit overlay in the running app —
first a legibility bump, then (once they saw that inline fix in the sidebar)
a request to move editing into a proper full-screen dialog entirely.

## Step 1: Fix the two known issues flagged in Step 2a's diary

**Author:** main

### Prompt Context

**Verbatim prompt:** `/suggest-next-iteration`
**Interpretation:** Ran the skill fresh in a new session (after `/clear`). Read `/PRD.md`, `/CONSTITUTION.md`, and `/IMPLEMENTATION_PLAN.md`, and cross-checked against `git log` and the workspace feature's file list to confirm Phases 1-7 and Phase 8 Steps 1-2a were shipped. The only remaining plan item — Phase 8 Step 2b ("wire interaction into `APPLY_IMAGE_EDIT` + `buildPdf`") — would finish the entire PRD, so I read Step 2a's diary (`/docs/diary/2026-08-21-image-interaction-ui.md`) for its "what warrants review" section before proposing options, since two of its three noted gaps looked like real, fixable bugs rather than open design questions. Presented three choices via `AskUserQuestion`: (1) do the full Step 2b in one pass, completing v1; (2) do just the state-wiring half of Step 2b, deferring `buildPdf` drawing; (3) fix the known issues from Step 2a's diary first, before touching export wiring. The user picked option 3.
**Inferred intent:** Same incremental-validation instinct the project has used throughout (see Step 2a's own diary for the pattern): clean up a known-broken interaction detail before building the next, more consequential layer (real PDF-space edit recording) on top of it, rather than carrying two known bugs into a bigger change where they'd be harder to isolate.

### What I did

- Read `/src/features/workspace/ImageRegionOverlay.tsx`, `/src/features/workspace/PagePreview.tsx`, and `/src/features/workspace/TextEditOverlay.tsx` to understand the two flagged gaps concretely before touching anything.
- **Fix 1 — overlay drift on window resize.** `ImageRegionOverlay`'s box state was seeded once, in a `useState` lazy initializer, from `initialBox(region, viewport, displayScale)` — multiplying by `displayScale` at that single moment and never again. If the window resized while "Show images" was active (changing `displayScale` via the `ResizeObserver` already wired up in `PagePreview`), the boxes would silently fall out of alignment with the canvas underneath, since nothing recomputed them. I changed `initialBox` to return geometry in raw viewport CSS-pixel units (i.e. before multiplying by `displayScale` at all), and moved the `* displayScale` multiplication to render time, in the JSX `style` object, so every render recomputes the on-screen position from the fixed raw geometry and the *current* `displayScale` prop. Pointer-drag math needed the matching inverse: `handlePointerMove` now divides the raw screen-pixel `dx`/`dy` by `displayScale` before applying it to the stored (raw-unit) box, and the `MIN_BOX_SIZE` clamp (still meant as an on-screen 16px floor) is likewise divided by `displayScale` before being compared against raw-unit width/height.
- **Fix 2 — "Show images" / "Edit text" pointer-event conflict.** Both overlays render as `pointer-events-auto` absolutely-positioned layers in the same stacking context; if both were active and their regions visually overlapped, whichever was later in DOM order (`ImageRegionOverlay`, rendered after `TextEditOverlay` in `PagePreview.tsx`) would sit on top and swallow the other's pointer events, with no way for the user to reach the buried layer. Rather than solving the z-order/hit-testing problem, I made the two modes mutually exclusive: `handleToggleEditText` now also turns off `isShowingImages` (and clears `imageRegions`) when entering edit-text mode, and `handleToggleShowImages` does the symmetric thing. Only one interactive overlay can ever be mounted at a time, so there's no overlap case left to handle.
- Ran `npx tsc -b` and `npx eslint .` from the project root — both passed clean with no changes needed beyond the two fixes above.
- Verified both fixes against the running app rather than trusting the diff alone. Reused a Playwright install and PDF fixtures (`fixtures/image-sample-2.pdf`) left in a prior session's scratchpad (`/private/tmp/claude-502/-Users-pratiksharma-repos-pdf-editor/82ef1d8f-03cb-4594-a8e9-da6066cf6329/scratchpad/pw`, which has its own `node_modules/playwright`), started the dev server locally on port 5175, and wrote a one-off `verify_fixes.mjs` script (deleted afterward) that:
  - Uploaded the two-image fixture, entered "Show images", dragged a box, then forced the canvas's displayed CSS width down by half via `element.style.width` (the `ResizeObserver` fires on the canvas element itself, so this is a faithful stand-in for a real window resize) and re-measured the box's `boundingBox()`.
  - Confirmed the box's offset from the canvas's left edge scaled by the same ratio the canvas itself shrank by, with 0.007px of drift — floating-point rounding, not a real misalignment. My first pass at this test used `page.setViewportSize` to shrink the browser window, which moved the whole layout around but didn't actually change the canvas's *displayed* size (it was already well under the `max-h-[75vh]`/`max-w-full` clamp), so that version of the test wasn't actually exercising the bug — worth noting since a resize test that doesn't change `displayScale` proves nothing about this fix.
  - Clicked "Edit text" and confirmed `boxes()` (the `.border-emerald-500` image-overlay selector) returned a count of 0 — i.e. no image boxes render while text-edit mode is active — with the "Show images" button's own label unaffected (still reads "Show images", not stuck in some inconsistent toggled-but-hidden state).
  - Zero console errors across the whole run.

### Why

Both issues were explicitly named as "what warrants review" items in the immediately-preceding diary entry rather than being freshly discovered here — the point of picking this option over doing Step 2b directly was to close out that known debt before it got tangled up in real PDF-space edit-recording logic, where a coordinate bug would be much harder to isolate from a genuine `viewport.convertToPdfPoint` mistake.

### What worked

- The raw-units-plus-render-time-scaling fix for Fix 1 is a small, mechanical change (three call sites: `initialBox`, the pointer-move delta, and the JSX `style`) that fully eliminates the bug class rather than papering over one instance of it — any future `displayScale` change (window resize, but also e.g. a future zoom control) is now handled automatically without needing another fix.
- Choosing "make the modes mutually exclusive" over "fix the z-order/hit-testing" for Fix 2 avoided a much fatter rabbit hole (deciding which layer should win where, per-pixel, for two independently-positioned sets of boxes) in favor of a one-paragraph behavioral rule that fully removes the ambiguity.
- Reusing the prior session's Playwright install and fixture PDFs (rather than re-installing or regenerating them) made verification fast — no setup cost beyond writing the two test scripts.
- `tsc -b`/`eslint .` passing on the first attempt for both fixes suggests the changes were type- and lint-clean by construction, not just superficially so.

### What didn't work

My first resize-drift test was a false negative waiting to happen: shrinking the Playwright viewport with `page.setViewportSize({ width: 900, height: 900 })` repositioned the whole page layout (the canvas moved left as the sidebar reflowed) but left the canvas's own rendered width completely unchanged, since 900px was still plenty of room for the canvas to render at its natural size under the `max-h-[75vh]`/`max-w-full` constraints. The test "passed" (0px drift) but for the wrong reason — position tracked because the box is already inside an absolutely-positioned container that moves with the layout, regardless of whether the underlying fix works. I caught this by checking `canvasAfter.width` against `canvasBefore.width` in the logged output and noticing they were identical, then switched to directly overriding the canvas element's `style.width` via `page.evaluate`, which reliably forces `displayScale` to actually change and is what let the test catch a real regression if one existed.

### What I learned

A resize/scale-drift test needs to assert on the thing that's actually supposed to change (here, `displayScale`, provable via the canvas's own measured width shrinking) before trusting a "no drift" result — otherwise the test can pass by construction without ever exercising the code path it's meant to cover. Logging the intermediate values (`canvasBefore`/`canvasAfter` width) rather than only the final pass/fail comparison is what surfaced this.

### What was tricky

Nothing about the fixes themselves was tricky — both were small, mechanical, well-scoped changes to code I'd just finished reading. The only friction was the false-negative test described above, caught before it was trusted rather than after.

### What warrants review

- `MIN_EDIT_FONT_PX` is unrelated to this step (see Step 2 below) but touches the same file family (`TextEditOverlay.tsx`) reviewed here — worth reviewing both diary steps together since they landed in the same session.
- The mutual-exclusivity fix for "Show images"/"Edit text" is a deliberate behavioral narrowing, not just a bug fix: a user can no longer see image boxes and text boxes overlaid at the same time, even in the (probably common) case where they don't overlap and there'd have been no actual conflict. This trades a small amount of flexibility for eliminating an entire bug class; worth confirming this matches the product's expectations if "compare an image's position against nearby text" ever becomes a real use case.

### Future work

Phase 8 Step 2b — wiring the (now bug-fixed) interaction into a real `APPLY_IMAGE_EDIT` reducer action and `buildPdf`'s occlude-then-redraw logic — is the only remaining item in `/IMPLEMENTATION_PLAN.md`. Completing it finishes every user story in `/PRD.md`.

## Step 2: Enlarge the text-edit box for legibility

**Author:** main

### Prompt Context

**Verbatim prompt:** "When selecting the page on a pdf it shows the preview this is good. However when editing the text it too small. In edit mode it should be made a bit bigger so user can easily edit it."
**Interpretation:** The user tried the running app (the preview panel from earlier work) and found the in-place text-edit boxes from Phase 7 too small to comfortably read/click into — most PDF body text renders at 9-11pt, which maps to a fairly small on-screen font at this app's preview scale. They want the edit experience made bigger, not the whole page preview.
**Inferred intent:** A direct usability fix to an already-shipped feature (Phase 7's in-place text editing), raised as soon as the user actually exercised it in the browser — not a new story, just making an existing one more usable.

### What I did

- Read `/src/features/workspace/TextEditOverlay.tsx` to see exactly how each edit box's size and font are currently computed: `fontSize = block.fontSize * viewport.scale * displayScale`, with `width`/`minHeight` derived the same way from the block's PDF-space bounding box.
- **First attempt (reverted):** added a `transform: scale(1.4)` (with `transformOrigin: 'top left'`) to the whole contentEditable box, reasoning that scaling the already-wrapped box uniformly would preserve the true width-to-font-size wrap ratio (the browser computes wrapping from the unscaled layout first, then the transform only affects final rendered pixels) while making everything bigger. I generated a small fixture PDF to test this — `@pdfme/pdf-lib` was already a project dependency but not globally installed, so a `node -e` one-liner using `require('pdf-lib')` failed with `Cannot find module 'pdf-lib'`; requiring `@pdfme/pdf-lib` (the actual installed package name) worked, and I wrote a 400×300pt page with a 9pt, `maxWidth: 320` paragraph starting at `x: 40` to `/private/tmp/.../scratchpad/text-sample.pdf`, then copied it into the Playwright scratchpad's `fixtures/` directory. A Playwright script (`verify_text_edit_size.mjs`) uploaded it, entered edit mode, and screenshotted the result.
- The screenshot showed the box visibly overflowing past the white page's right edge into the gray background — the 320pt-wide block already left only a ~40pt margin to the page edge, and scaling the whole box by 1.4 pushed its right edge roughly 130px past where the original block ended, well outside the visible page. This is a fixture-specific number, but the underlying problem generalizes: any text block that already runs close to a page's margin (common) will overflow under whole-box scaling, since the transform grows the box outward from its top-left corner with no awareness of how much room is actually available to its right/below.
- **Second, final approach:** reverted the transform, and instead raised only the *font size*, via `Math.max(block.fontSize * viewport.scale * displayScale, MIN_EDIT_FONT_PX)` with `MIN_EDIT_FONT_PX = 15`, leaving `width` untouched (still exactly the block's real on-screen width) so the box's horizontal footprint can never exceed the block's true boundary. Since `minHeight` (not a fixed `height`) already lets the box grow downward to fit however many lines the text wraps into, a bigger font just means more/taller wrapped lines and a taller box — which was already the existing, expected behavior for any edit that makes text longer than the original. Also bumped `lineHeight` from 1.15 to 1.3 to keep the now-larger text visually comfortable rather than cramped.
- Re-ran `npx tsc -b` and `npx eslint .` — clean. Re-ran the same Playwright script against the fix: the rendered box width stayed exactly at the block's true width (267.8px, unchanged from before the fix), height grew from what it would have been to 138.5px to fit the taller wrapped lines, and the screenshot showed the enlarged text sitting entirely inside the white page with no overflow. Also typed `" EDITED"` into the middle of the live text via `page.keyboard.type` and confirmed it landed correctly mid-sentence with zero console errors, confirming `contentEditable` behaves normally at the new font size.
- Deleted the temporary Playwright script and fixture-generation script; left the `text-sample.pdf` fixture in the scratchpad in case it's useful again, but did not add it to the repo.

### Why

The user's complaint was specifically about legibility/comfort while typing, not about the box's positioning accuracy — so the fix needed to make the *font* bigger without disturbing the thing that makes the reflow preview trustworthy (the box's width, which directly determines how many words fit per line, exactly mirrors what `buildPdf` will use to hard-wrap the real output later). Changing width would have both risked visual overflow (as the first attempt demonstrated) and made the on-screen wrap preview lie about how the real export will look.

### What worked

- Testing the first approach against a real fixture caught the overflow bug from a screenshot before it shipped, rather than from a later bug report — the numbers alone (box width 374.9px reported by `boundingBox()`) didn't obviously signal "this overflows the page" without also looking at the rendered image.
- The font-only fix is simple enough that there's no new edge case to reason about: `Math.max(..., 15)` can only ever make text bigger than its natural size, never smaller, and the box's existing `minHeight`-not-`height` behavior already handled "more lines than the original" gracefully (Phase 7 already needed this for ordinary longer-text edits).

### What didn't work

The `transform: scale()` approach — recorded in detail above under "What I did" rather than repeated here, since the failure and the reasoning behind it are the same thing. The core lesson: a fix that looks correct by reasoning about *one* invariant (wrap-ratio accuracy) can still break a *different* invariant (staying inside the page) that wasn't part of the original reasoning — worth checking a visual fixture against a realistic, near-margin block specifically, not just any block.

### What I learned

`require('pdf-lib')` fails in this repo even though `pdf-lib` is a "real" dependency conceptually — the actual installed package is `@pdfme/pdf-lib` (per `/CONSTITUTION.md`'s fixed-dependency list), a fork/rename, not the vanilla `pdf-lib` package. Any future one-off script that needs to generate a test PDF should `require('@pdfme/pdf-lib')` directly rather than assuming the upstream package name.

### What was tricky

Judging the right minimum font size (`MIN_EDIT_FONT_PX = 15`) was a bit of a guess rather than something derived from a hard constraint — it's a "looks comfortable in a screenshot" number, not a calculated one. If it later feels too big or too small in practice, it's a one-line constant to tune, not a structural change.

### What warrants review

- `MIN_EDIT_FONT_PX = 15` is a subjective legibility floor picked by eye from one screenshot on one fixture; worth a second look against a real, denser multi-paragraph document (small headings, footnotes, etc.) where several very-differently-sized blocks might all get clamped to the same 15px floor and end up looking more uniform than the source document actually is.
- Confirm the taller boxes that result from the font floor don't visually collide with an adjacent block positioned close below it in a real document — this wasn't tested against a multi-block page, only the single-paragraph fixture built for this step.

### Future work

None specific to this fix — it's a standalone legibility tweak to an already-shipped feature. The broader remaining work is still Phase 8 Step 2b, as noted in Step 1 above. (Superseded sooner than expected — see Step 3: the font-size bump alone wasn't enough once the user saw it running in the app.)

## Step 3: Move text editing into a full-screen dialog

**Author:** main

### Prompt Context

**Verbatim prompt:** "the editing screen is too much scrammbled. I want this to be fixed lets open the editing in bigger dialog so its easier to edit."
**Interpretation:** Sent mid-turn, right after Step 2's font-size fix, once the user actually looked at the running app rather than just a screenshot. Step 2 made the font bigger but didn't touch the fact that all of this — the canvas, the amber caveat banner, the edit boxes, their hover controls — was crammed into `Workspace.tsx`'s `<aside className="w-[26rem] ...">`, a fixed 26rem (416px) sidebar column shared with nothing else, but still narrow relative to the rest of the screen. The user wants the whole editing experience moved into a larger, dedicated dialog rather than incrementally enlarging elements within that same cramped column.
**Inferred intent:** A structural UI fix, not another parameter tweak — the sidebar itself is the constraint, so the request is to give text editing its own larger surface (a modal/dialog) rather than trying to make more things fit into 416px.

### What I did

- Read `/src/features/workspace/Workspace.tsx` to confirm the actual constraint: the preview lives in `<aside className="w-[26rem] shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-6">`, a fixed-width column next to the thumbnail grid — this is what was really behind "too scrambled," not just small fonts.
- Created `/src/features/workspace/TextEditDialog.tsx`, a new full-screen dialog component that owns its own independent page render at a larger scale (`DIALOG_SCALE = 2.2`, versus `PagePreview`'s existing `PREVIEW_SCALE = 1.4`) and its own `TextEditOverlay` instance, so opening it doesn't touch or resize the small inline preview at all. It's structured as a `fixed inset-0 z-50` backdrop (`bg-slate-900/60`) with a centered `max-w-5xl` white panel containing: a header with "Editing text — page X of Y" and a "Done editing" button, the existing amber non-destructiveness caveat banner (moved here verbatim from `PagePreview`), and the canvas + overlay inside a scrollable, padded frame (`max-h-[78vh] max-w-[80vw]` on the canvas itself, giving it far more room than the old 416px column ever could).
- Added an Escape-key handler and a backdrop-click handler, both routed through one `closeAndCommitPending` (wrapped in `useCallback` so it can sit in the Escape effect's dependency array without an eslint-disable): before calling `onClose`, it blurs `document.activeElement` if it's an `HTMLElement`. This matters because a pending edit only commits via the edit box's own `onBlur` handler (unchanged from Phase 7) — closing the dialog without first blurring whatever's focused would silently discard an in-progress edit.
- Gutted the corresponding pieces out of `/src/features/workspace/PagePreview.tsx`: removed the `textBlocks` state and its `getTextBlocks` effect, the inline `<TextEditOverlay>` render, `handleCommitBlock`, and the inline caveat banner — all of that now lives solely in `TextEditDialog`. `handleToggleEditText` became `handleOpenTextEdit` (no more "toggle," since the button now just opens the dialog; the dialog's own "Done editing" button and Escape/backdrop handlers are what close it). The "Edit text" button lost its `isEditingText`-conditional blue-filled/text-only styling, since it no longer represents an active/inactive toggle state — it's now always the same "open the dialog" button. `PagePreview` still owns the `isEditingText` boolean (now just "is the dialog open"), and conditionally mounts `<TextEditDialog onClose={() => setIsEditingText(false)} ... />`.
- While editing `PagePreview.tsx`, the project's `impeccable` design-review hook flagged the new plain "Edit text" button (`text-blue-600 hover:bg-blue-50 disabled:text-slate-300`) as gray-on-colored-background — disabling the button while a mouse still hovers it would show gray `disabled:text-slate-300` text against the `hover:bg-blue-50` background. Rather than suppress the finding, I checked `Workspace.tsx`'s existing Undo/Redo buttons, which already guard against exactly this with `disabled:hover:bg-transparent`, and applied the same class to both the "Edit text" button and (for consistency, since it has the identical pattern) the "Show images" button.
- Ran `npx tsc -b` and `npx eslint .` — clean.
- Verified against the running app with a fresh Playwright script (`verify_text_dialog.mjs`, deleted after use), reusing the `text-sample.pdf` fixture from Step 2: opened "Edit text," confirmed the dialog rendered with both the caveat text and a "Done editing" button, and measured the edit box at 691×105px — up from roughly 268×138px inline in the old sidebar (a rough proxy for "no longer scrambled," not an exact before/after of the same state). Typed `" ADDED"` at the end of the paragraph, pressed Escape, and confirmed the `contentEditable` count dropped to 0 (dialog closed). To confirm the edit actually committed rather than being silently dropped by the Escape-close path, clicked "Download" (with `acceptDownloads: true` on the Playwright context, needed for the `download` event to fire at all) and inspected the resulting file. A naive `latin1` substring search for `"ADDED"` in the raw downloaded bytes came up empty — not because the edit was missing, but because `@pdfme/pdf-lib`'s `.save()` compresses content streams, so there's no plaintext to grep. Re-verified properly by loading the downloaded PDF through `pdfjs-dist`'s ESM build (`node_modules/pdfjs-dist/legacy/build/pdf.mjs` — the CJS entry point doesn't exist in this version, `require('pdfjs-dist/legacy/build/pdf.js')` fails with `Cannot find module`) and calling `getTextContent()`, which returned the edited line reading "...even though the source ADDED font here is fairly small." — proof the escape-to-close path correctly blurs and commits before the dialog unmounts.
- Reviewed the `shot-dialog-open.png` screenshot: the dialog fills most of the viewport, the edit box is comfortably large with no page-edge overflow, and the dimmed backdrop clearly shows the rest of the app behind it. Noted one pre-existing cosmetic detail while looking at it — the edit box's `bg-white/90` background (from `TextEditOverlay`, untouched by this step) lets a faint ghost of the original small-font text show through behind the enlarged box — but this is the same intentional semi-transparency Phase 7 already used, not something this step introduced, and not something the user's complaint was about.

### Why

The user's own diagnosis — "the editing screen is too much scrambled" — pointed at layout, not font size: Step 2 had already fixed legibility, but the box was still fighting for room inside a 416px column shared with a caveat banner and hover controls. A dialog sidesteps the constraint entirely rather than trying to out-shrink it, and reusing the exact same `TextEditOverlay` component (unchanged) inside the new dialog means the actual editing mechanics — positioning math, commit-on-blur, `MIN_EDIT_FONT_PX` from Step 2 — didn't need to be touched or re-verified, only where they're mounted.

### What worked

- Reusing `TextEditOverlay` completely unchanged inside the new dialog meant this step was purely about the container (where/how big), not the editing mechanics themselves — no risk of re-breaking Step 2's font-size fix or Phase 7's commit-on-blur behavior.
- Structuring the close logic around one `closeAndCommitPending` callback (rather than duplicating "blur then close" in three places — Escape, backdrop click, Done button) meant there was exactly one place to get the blur-before-close ordering right, and the Playwright test's Escape-then-inspect-the-download check exercises that exact path.
- Catching the `impeccable` hook's gray-on-color finding and fixing it via an existing, already-established codebase pattern (`disabled:hover:bg-transparent`, already used on Undo/Redo in `Workspace.tsx`) rather than reaching for a suppression — the fix was one class per button and matched what the rest of the app already does.

### What didn't work

The first attempt at verifying the edit reached the export — a raw `latin1` string search for `"ADDED"` in the downloaded PDF's bytes — came back `false` and briefly looked like the whole feature was broken. It wasn't: `@pdfme/pdf-lib` compresses content streams by default, so there's no literal ASCII text sitting in the file to grep for, compressed or encoded text isn't something a substring search will ever find regardless of whether the edit worked. Re-running the check by actually parsing the PDF (via `pdfjs-dist`'s `getTextContent()`, the same API the app itself uses to detect text blocks) rather than treating it as an opaque byte blob gave the real answer.

### What I learned

Verifying "did text make it into an exported PDF" needs a real PDF parser, not a substring search on the file's bytes — pdf-lib's default output isn't human-readable even when the feature works correctly, so a naive text search is not just an insufficient check but an actively misleading one. `pdfjs-dist` (already the project's rendering dependency) is the natural tool to reach for here since the app already trusts it elsewhere, and its Node/ESM entry point lives at `node_modules/pdfjs-dist/legacy/build/pdf.mjs` — there's no CommonJS `pdf.js` at that path in this installed version, only `.mjs`, so any future one-off verification script needs to be written as an ES module (or use dynamic `import()`), not `require()`.

### What was tricky

Nothing in the implementation itself was tricky — the trickiest part was purely in verifying it, described above. The implementation was largely a matter of relocating existing, working pieces (the overlay component, the caveat banner, the commit-on-blur flow) into a new container rather than inventing new mechanics.

### What warrants review

- The dialog's `DIALOG_SCALE = 2.2` (vs. `PagePreview`'s `PREVIEW_SCALE = 1.4`) is, like Step 2's `MIN_EDIT_FONT_PX`, a by-eye choice rather than a calculated one — worth a second look on a real, denser multi-column or small-page document to confirm it doesn't render an oversized canvas that itself needs scrolling within the dialog's `overflow-auto` frame in an awkward way.
- The backdrop-click-to-close behavior means clicking anywhere outside the white panel (but still inside the darkened backdrop) closes the dialog — this is standard modal behavior, but combined with the "blur commits pending edits" logic, a user who clicks the backdrop while mid-edit will have that edit silently committed on their way out rather than being asked to confirm. This matches how blur-to-commit already worked before (clicking anywhere else on the old inline panel had the same effect), so it's not a new risk, just worth being aware it carries over.
- Only the text-edit experience moved into a dialog in this step; "Show images" still renders inline in the small `PagePreview` panel, unchanged. If the same "too scrambled" complaint comes up for image editing once Phase 8 Step 2b adds real interaction commit logic there, the same dialog pattern established here would be the natural thing to reuse.

### Future work

Phase 8 Step 2b (wiring image interaction into `APPLY_IMAGE_EDIT` + `buildPdf`) remains the only item left in `/IMPLEMENTATION_PLAN.md` to complete every user story in `/PRD.md`. Given this session's pattern — two rounds of "try it, then ask for more room/size" — it may be worth proactively checking whether the image-editing overlay (still inline in the small sidebar panel) will need the same dialog treatment once its interaction is fully wired up, rather than waiting for the same complaint to recur. (Superseded sooner than expected again — see Step 4, which found the dialog alone didn't fix a real document.)

## Step 4: Fix overlay text doubling and page-context loss on dense documents

**Author:** main

### Prompt Context

**Verbatim prompt:** "while editing it looses the context from the background I want to keep the background. and it is scrammbled,[Image #1] here is the image for example." — attached a screenshot of a real instrument report ("Sample Report" / FOSS) opened in edit-text mode, showing many overlapping, doubled-looking text boxes covering nearly the whole page.
**Interpretation:** The user tried the Step 3 dialog against a real, densely-packed document — a form-style report with many short, tightly-stacked lines (labels, a data table, event messages) — rather than the sparse single-paragraph fixture used to verify Steps 2 and 3. The screenshot showed something qualitatively worse than "small text": every detected block was simultaneously enlarged and given a near-opaque background, and on this document the blocks span nearly the entire page, so they collided into a mess of doubled/overlapping text and obscured everything that wasn't inside a text block (borders, whitespace, alignment) — the "context" the user wants kept.
**Inferred intent:** Fix the actual rendering defect (not just resize the dialog again) so that editing a real, dense document looks like the source document until the user actively clicks into a specific block — matching how a normal WYSIWYG editor would let you click into one field without the whole page's layout falling apart.

### What I did

- Could not use the user's actual FOSS report PDF (only a screenshot was provided), so built a synthetic fixture in the same shape — `/private/tmp/.../scratchpad/dense-report.pdf`, generated via a `node -e` script using `@pdfme/pdf-lib`: a 620×700pt page with a title, two header fields, a 14-line "Sample Information" list, a 6-row data table, a 4-line events list, and a footer, all at 9pt Helvetica with 13pt line gaps — deliberately mimicking the real report's density rather than the sparse single-paragraph fixture used in Steps 2-3. Copied it into the Playwright scratchpad's `fixtures/` directory as `dense-report.pdf`.
- First screenshot against this fixture (`shot-dense-unfocused.png`, from a first attempt described below) reproduced the user's exact symptom: doubled, overlapping, hard-to-read text across most of the page, confirming the fixture was a faithful enough reproduction to debug against.
- **First attempt (partially wrong hypothesis):** assumed the problem was purely "too many blocks enlarged/opaque at once," so changed `/src/features/workspace/TextEditOverlay.tsx` to track a `focusedId` via `useState`, popping out only the focused block (opaque background, border, `MIN_EDIT_FONT_PX` floor, raised `zIndex`) while rendering every other block at its *natural*, unmodified font size with a fully transparent background — the idea being that a block at its true size, positioned via the same PDF-to-viewport math already used, would sit invisibly on top of the matching canvas pixels underneath. Re-ran the Playwright script against the dense fixture and the screenshot still showed heavy doubling/ghosting — the natural-size unfocused boxes were still visibly duplicating the canvas text underneath them, just less enlarged than before.
- Diagnosed the real cause by re-examining the screenshot closely: the doubling wasn't primarily about size or opacity, it was misalignment — a block's own multi-line text, laid out by the browser at a generic `line-height` inside a fixed-width `contentEditable` div, doesn't reproduce pdf.js's original per-line vertical spacing precisely enough over many lines. For a tall, multi-line block (this fixture's clustering merged most of the page's rows into a handful of large blocks — see "What warrants review" below), that per-line drift accumulates visibly, so even "correctly" sized overlay text increasingly disagrees with the canvas pixels below it the further down the block you go. The original design's opaque `bg-white/90` had been silently relying on covering this misalignment, not just signaling "this is editable."
- **Second, correct fix:** rather than trying to make unfocused text pixel-perfect (not reliably achievable given the wrapping-vs-original-layout mismatch), made unfocused blocks fully invisible — `text-transparent`, transparent background and border — so they're pure click targets sitting over the untouched canvas with zero visible content of their own, and therefore zero possibility of visibly disagreeing with what's underneath. Added `overflow-hidden` on the unfocused state (previously `overflow-visible` unconditionally) so invisible wrapped text that runs taller than the block's real bounding box can't silently expand the clickable hit-region into a neighboring block's territory. The focused state keeps its own `overflow-visible`, opaque white background, visible `text-slate-900`, border, shadow, and the `MIN_EDIT_FONT_PX` floor from Step 2 — now scoped to just the one active block. Added a subtle `hover:border-dashed hover:border-blue-300 hover:bg-blue-50/30` on the unfocused state so blocks remain discoverable as clickable without ever rendering their own (potentially misaligned) text.
- Ran `npx tsc -b` / `npx eslint .` after each of the two attempts — clean both times, since this was purely a Tailwind-class/JSX conditional change, not a type-level one.
- Re-verified against the dense fixture: `shot-dense-unfocused.png` now looks pixel-for-pixel like the plain source document (screenshotted and visually compared side-by-side — no doubling, no obscured whitespace, the data table's alignment fully intact). Clicked into the "ALMIDON" row's block, confirmed only that one block pops out (`shot-dense-focused.png`), typed `" EDITED"`, then clicked the dialog's header to blur, and confirmed the page returns to looking exactly like the unfocused state again (`shot-dense-after-blur.png`) — no leftover visual artifact from the edit, since the edited block just goes back to being invisible. Downloaded the result (`acceptDownloads: true` on the Playwright context, same as Step 3) and parsed it with `pdfjs-dist`'s `getTextContent()`: confirmed the exported PDF's actual text includes "EDITED" in the right place, proving the commit-on-blur flow still works correctly even though the edited text was never visibly rendered on screen while unfocused.

### Why

The two complaints in the prompt — "loses the context from the background" and "scrambled" — turned out to share one root cause once actually debugged against a realistic document: rendering every detected block's text as a second, independently-laid-out copy on top of the first (the canvas). At low density (Steps 2-3's single-paragraph fixture) this was invisible enough not to matter; at real-world density it visibly doubles and, combined with every block being enlarged/opaque simultaneously, obscures the page. Removing the redundant visible copy (rather than trying to make the copy more accurate) fixes both complaints from the same change, and is also strictly simpler than chasing pixel-perfect line-height matching.

### What worked

- Building a fixture that deliberately matched the *density* of the reported document (many short, tightly-packed lines) rather than just "a longer paragraph" was what actually reproduced the bug — Steps 2-3's sparse fixture would not have caught this, since the misalignment-per-line effect only compounds visibly over many lines in a tightly stacked block.
- Screenshotting after each hypothesis (first the naive "only enlarge the focused one" attempt, then the "make unfocused invisible" fix) rather than reasoning about it purely from the code caught that the first attempt's premise — "natural-size overlay text will align with the canvas" — was false before it shipped.
- Reusing the exact same commit-on-blur/`onApplyTextEdit` plumbing from Phase 7 meant this was purely a rendering fix; verifying the export still worked via the `pdfjs-dist`-based check from Step 3 was a five-minute re-run, not new work.

### What didn't work

The first attempt — natural font size, transparent background, for unfocused blocks — was a reasonable-sounding hypothesis (matching the recorded font size to the visible canvas text) that turned out to address the wrong variable. Size/opacity was a real contributor but not the actual mechanism producing the "doubled" look in the screenshot; the deeper issue was that the browser's line-wrapping inside a multi-line block was never guaranteed to reproduce the original per-line spacing in the first place, so *any* visible overlay text on a multi-line block — regardless of size — was going to drift out of alignment eventually. Catching this required looking at the actual re-rendered screenshot rather than trusting the first fix's reasoning.

### What I learned

An overlay that's meant to sit exactly on top of rendered canvas content needs to either (a) be provably pixel-accurate against that content, or (b) not render its own visible copy of the content at all — there's no safe middle ground where "close enough" sizing is good enough, because misalignment compounds with every line and becomes obviously wrong exactly on the documents (dense, many-line blocks) where users are most likely to need to edit precisely. This is a case where a real, structurally different sample document (not just a longer version of the same simple case) was necessary to find the bug — the single-paragraph fixture from Steps 2-3 was not a sufficient stand-in for "a real document," despite having already been used to verify two prior rounds of this same feature area.

### What was tricky

Distinguishing "too many boxes enlarged at once" (the size/collision problem, real but not sufficient on its own) from "overlay text doesn't align with canvas text" (the actual doubling mechanism) required comparing the first attempt's screenshot against the original bug report's screenshot carefully — both look superficially similar ("messy overlapping text"), but only one of the two fixes (making text invisible, not just correctly-sized) actually resolves the doubling artifact specifically.

### What warrants review

- While debugging, noticed the text-block clustering heuristic (from Phase 7, `/src/lib/textBlocks.ts`, untouched in this step) merged nearly the entire densely-packed fixture into just 5 large blocks — clicking into the "ALMIDON" data row's block, for instance, popped out a single edit box spanning from "Sample Information" all the way down through the data table and partway into the events list (visible in `shot-dense-focused.png`). This is a distinct, pre-existing limitation from the one fixed here (IMPLEMENTATION_PLAN.md's own Phase 7 section already flagged the clustering thresholds as heuristic and expected to need tuning against real documents) — worth a dedicated look against the user's actual report PDF (not available in this session, only a screenshot of it) to see whether the clustering groups sections the way a user would actually want to edit them independently, since right now a small correction to one data row would drag a much larger unrelated region into the same edit box.
- The invisible-unfocused-text approach depends on the block's positioning math (left/top/width/height, from `viewport.convertToViewportPoint`) being correct even though there's no visible text to eyeball-check it against anymore — a badly-positioned invisible hit-region would now fail silently (clicking near text does nothing, or clicks the wrong block) rather than being visually obvious the way a misaligned *visible* box would have been. Worth keeping in mind if a future report says "I can't click into this text" rather than a visual complaint.

### Future work

Re-verify this fix and the clustering-breadth question above against the user's actual FOSS-style report PDF once available, rather than only the synthetic reproduction built for this step. The clustering breadth issue (previous bullet) is a reasonable candidate for the next iteration if the user finds edit boxes are still grouping more content than expected, separate from Phase 8 Step 2b which remains the only item left to complete the full `/PRD.md`.
