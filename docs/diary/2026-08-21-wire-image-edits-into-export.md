# Diary: Wire image interaction into export, move it into a dialog

Goal: finish Phase 8 Step 2b — the last remaining item in `IMPLEMENTATION_PLAN.md` — by
wiring the already-built image move/resize/delete interaction into a real
`APPLY_IMAGE_EDIT` reducer action and `buildPdf`'s occlude-and-redraw logic,
and (per this iteration's chosen scope) giving image editing its own
full-screen dialog to match how text editing already works. Completing this
finishes every user story in `PRD.md`.

## Step 1: Full Step 2b, with a dialog

**Author:** main

### Prompt Context

**Verbatim prompt:** `/suggest-next-iteration`
**Interpretation:** Fresh session (after `/clear`). Read `PRD.md`, `CONSTITUTION.md`, and `IMPLEMENTATION_PLAN.md`; confirmed every phase was shipped except Phase 8 Step 2b, the plan's last remaining item. Also noticed the prior session's clustering/dialog-sizing fixes were still uncommitted, and flagged an unrelated `package-lock.json` staged-deletion to the user before proceeding (neither touched here). Since Step 2b's own two sub-steps (state-wiring, then `buildPdf` drawing) and this session's now-established "does this need its own dialog" question were both live options, proposed three choices via `AskUserQuestion`: (1) full Step 2b, keeping image editing inline in the small sidebar panel as originally planned; (2) full Step 2b plus moving image editing into a full-screen dialog like text editing already has, since the small-panel UX problem that motivated that move applies equally to images and was flagged as future work in an earlier session; (3) state-wiring only, deferring `buildPdf`'s drawing logic. The user picked option 2.
**Inferred intent:** Finish the entire PRD in one iteration, and proactively avoid shipping the same cramped-sidebar UX text editing just moved away from, rather than waiting for the user to notice and ask again.

### What I did

- Read `src/features/workspace/types.ts` (the already-defined `PageEdit` image variant: `originalBoundingBox`, `newBoundingBox`, `imageBytes`, `imageFormat`), `workspaceReducer.ts`, `src/lib/imageRegions.ts` (image detection via `getOperatorList` matrix-tracking), and `src/lib/pdfExport.ts` (`buildPdf`'s existing `applyEdit`, which already had `if (edit.type !== 'text') return // image edits land in Phase 8` as an explicit placeholder) to understand exactly what was already in place versus what Step 2b needed to add.
- **Reducer**: added `APPLY_IMAGE_EDIT` to both `WorkspaceAction` and `PagesAction` in `workspaceReducer.ts`, plus a new `upsertImageEdit` helper. Rather than always appending a new edit (like `APPLY_TEXT_EDIT` does), it replaces an existing edit for the *same original image* — matched by exact `originalBoundingBox` equality, which stays constant across repeated interactions with one image. This matters because `originalBoundingBox` is always the image's true starting position: if a user drags an image and then resizes it, two *appended* edits would both draw the image (the drag's copy at its dragged spot, the resize's copy at its resized spot), since the resize edit's occlusion only covers the *original* spot, not the drag's already-drawn one — producing a visible duplicate in the output. Upserting means there's always at most one edit per original image, so `buildPdf` only ever draws its final, current state.
- **Pixel extraction**: added `cropRegionToPng(canvas, region, viewport)` to `src/lib/imageRegions.ts`. This was the one real design decision in this step — the plan's own text suggested reading `imageBytes`/`imageFormat` from the page's `XObject` resource dictionary via pdf-lib's low-level object model. I chose a different approach instead: crop the relevant rectangle directly out of the already-rendered page `<canvas>` (via an offscreen canvas + `drawImage` + `toBlob('image/png')`), rather than reading the PDF's internal image stream. Reasoning: a raw XObject stream's bytes aren't necessarily valid, self-contained JPEG/PNG file bytes on their own — that depends on the stream's filter (`DCTDecode` gives you real JPEG bytes; `FlateDecode` gives you a raw, unwrapped bitmap that pdf-lib's `embedPng`/`embedJpg` can't parse as-is) and color space, which would need real, filter-specific handling to do generally and reliably. Cropping the canvas sidesteps all of that: it always produces a normal, self-contained PNG, at the cost of re-rasterizing at the dialog's render resolution rather than the image's native one — an accepted v1 simplification given the PRD's existing tolerance for imperfect fidelity in this feature (font substitution in Phase 7's text editing is the same kind of trade-off).
- **`buildPdf`**: replaced the `if (edit.type !== 'text') return` placeholder in `applyEdit` with a proper branch to a new `applyImageEdit` function — draws a white occluding rectangle over `originalBoundingBox`, then (unless `newBoundingBox` is `null`, meaning deleted) `embedPng`/`embedJpg`s `imageBytes` and `drawImage`s it at `newBoundingBox`.
- **New `ImageEditDialog.tsx`**, structured identically to the existing `TextEditDialog.tsx` (same full-screen backdrop, `max-w-[95vw]` panel, width-only canvas sizing with no height cap so natural rendering is comfortably large, `overflow-auto` frame for scrolling): owns its own canvas render, fetches `getPageImageRegions`, and renders the existing `ImageRegionOverlay` on top. Added an `onCommit(region, box | null)` callback to `ImageRegionOverlay` (previously interaction-only, per the prior session's Step 2a) — called on a drag/resize gesture's `pointerup` (guarded so a click that didn't actually move anything doesn't fire a spurious commit) and on delete. The dialog's `handleCommitRegion` converts a committed box (already tracked in raw viewport units, per an earlier session's resize-drift fix) into PDF-space via `viewport.convertToPdfPoint`, crops the image's pixels via `cropRegionToPng`, and dispatches `APPLY_IMAGE_EDIT`.
- **`PagePreview.tsx`**: removed the inline `ImageRegionOverlay`/`imageRegions` state and the "Show images" toggle entirely (along with the now-fully-unused `viewport`/`displayScale` state and their `ResizeObserver` effect, since neither dialog needs the small panel to track those anymore) — replaced with an "Edit images" button that opens `ImageEditDialog`, exactly mirroring "Edit text"/`TextEditDialog`. Opening either dialog now closes the other first, avoiding a stacked-dialog state.
- **Renamed `hasSeenTextEditCaveat`/`onDismissTextEditCaveat` to `hasSeenEditCaveat`/`onDismissEditCaveat`** throughout (`Workspace.tsx`, `PagePreview.tsx`, `TextEditDialog.tsx`, and the new `ImageEditDialog.tsx`) via a targeted `sed` across the four files, then verified with a `grep` that no stale references remained. Both dialogs now share one disclosure flag and a generalized caveat message ("Edited or covered content isn't fully removed…" rather than "text" specifically), since it's the same underlying limitation either way and there's no reason to show it twice in one session.
- **`Workspace.tsx`**: added `onApplyImageEdit` prop wiring (`dispatch({ type: 'APPLY_IMAGE_EDIT', pageId, edit })`), passed to `PagePreview` alongside the existing `onApplyTextEdit`.
- Ran `npx tsc -b` and `npx eslint .` after each major change — clean throughout, including after the caveat rename.
- Verified against the running app with fresh Playwright scripts (written and deleted within this step) and the `image-sample-2.pdf` fixture (two images) reused from an earlier session's scratchpad: opened "Edit images," confirmed the dialog rendered both images with the shared caveat banner, dragged image 1 by a mouse delta of `(60, 40)` and resized image 2 via its corner handle, confirmed zero console errors, then closed and downloaded. Rather than trust the visual screenshot alone, re-ran the same `getOperatorList`-based region-detection logic from `imageRegions.ts` (copied inline into a one-off verification script) against the *downloaded* PDF and compared it numerically to the same detection run against the *original* fixture:
  - Original: image 1 at `(30, 150)`, 200×120; image 2 at `(270, 40)`, 100×80.
  - Exported file had **4** `paintImageXObject` calls, not 2 — as expected, since the original images remain physically present under the occluding rectangles (the documented, unavoidable caveat): the two original regions unchanged, plus two new ones — image 1 redrawn at `(57.27, 131.82)` still exactly 200×120 (moved, not resized — correct for a pure drag), and image 2 redrawn at `(270, 30.9)`, grown to 113.6×89.1 (resized from its bottom-right handle, so its top-left corner — and thus its PDF-space top edge — correctly stayed anchored while its bottom edge, `y`, moved down by exactly the height increase).
  - A second script tested delete: hovered image 1, clicked its delete (×) button, confirmed the overlay's box count dropped from 2 to 1, downloaded, and confirmed the export had exactly 2 `paintImageXObject` calls (both originals, no third redrawn copy for the deleted image) — i.e. occluded, not redrawn, as `applyImageEdit`'s `if (!edit.newBoundingBox) return` branch intends.
  - Also clicked "Undo" after the delete-and-download, reopened "Edit images," and confirmed the overlay's box count went back to 2 — i.e. Phase 4's undo/redo covers `APPLY_IMAGE_EDIT` automatically, exactly as the original plan predicted (it's part of the same `pages`-slice history wrapper, no special-casing needed).
- Updated `IMPLEMENTATION_PLAN.md`'s Phase 8 Step 2b section to `✅ Shipped`, documenting the XObject-vs-canvas-crop deviation from the plan's original suggestion and the upsert-by-`originalBoundingBox` refinement (neither was specified in the original plan text).

### Why

The upsert-by-`originalBoundingBox` design and the canvas-crop approach to image bytes were both things the plan's prose didn't fully anticipate (the plan assumed one edit per interaction was fine, and assumed XObject resource-dictionary reading would just work) — both turned out to need a real design decision once actually implementing against pdf-lib's real API surface and the real consequence of stacking multiple edits per image. Choosing robustness (canvas crop always yields a valid PNG; upserting always yields a correct final image state) over strictly following the plan's original suggestion seemed like the right call given the plan itself was explicit that its Phase 8 design was "a first attempt to validate, not a fixed spec."

### What worked

- Numerically comparing exported image positions against hand-computed expected values (not just eyeballing a screenshot) caught real signal: confirming the resize's `y` shift exactly equaled its height increase is a specific, falsifiable check that a passing screenshot alone wouldn't have caught if the sign or anchor point had been subtly wrong.
- The `originalBoundingBox`-equality upsert fell out cleanly from data already being recorded (`originalBoundingBox` was always going to be needed for occlusion regardless) — no new tracking mechanism was needed, just a different reducer strategy for the same shape of data.
- Reusing `TextEditDialog`'s exact structure for `ImageEditDialog` (same backdrop, same width-only sizing fix from an earlier session, same Escape/backdrop-close pattern) meant this dialog needed no new design decisions of its own — only the interaction/commit logic underneath differed.
- The caveat-message rename was mechanical (a four-file `sed` plus a `grep` to confirm no strays) and low-risk precisely because both dialogs already shared the same underlying concept; renaming it rather than duplicating a second flag kept the "have you seen this warning yet" state meaningful across both edit types in one session.

### What didn't work

Nothing failed outright in this step. The closest thing to a wrong turn was almost following the plan's literal suggestion (XObject resource-dictionary reading) before working out during implementation that it doesn't generalize to non-JPEG images without real filter-specific decoding work — caught by reasoning about pdf-lib's actual embed APIs before writing any code against the resource-dictionary approach, not by a failed attempt.

### What I learned

A PDF image XObject's raw stream bytes are not interchangeable with a "real" image file's bytes in general — whether they're directly usable by `embedJpg`/`embedPng` depends entirely on the stream's `Filter` entry, and only `DCTDecode` (JPEG) reliably survives that trip unmodified. Sourcing pixels from an already-rendered canvas instead is a general-purpose way to sidestep needing to understand or handle every PDF image encoding pdf.js already decodes for you — a reasonable pattern to reach for whenever "read the original bytes back out" turns out to be more format-sensitive than it first looks.

### What was tricky

Working out the correct PDF-space math for `applyImageEdit`'s occlusion-then-redraw wasn't tricky in itself (it mirrors Phase 7's text-edit occlusion exactly), but *trusting* that the resize case's y-axis behavior was correct (rather than an off-by-one-axis bug) required actually computing the expected numbers by hand and comparing, since PDF space (y-up, `y` = bottom edge) and screen/canvas space (y-down, box `top` = smaller `y`) invert in a way that's easy to get subtly backwards without a concrete before/after check.

### What warrants review

- `cropRegionToPng` always produces PNG output regardless of the original image's format or compression — a deliberate v1 simplification (see "What I did" above), but worth knowing if a user notices file size growth for photo-heavy PDFs edited this way (PNG doesn't lossy-compress the way JPEG does, and the crop is taken at the dialog's render resolution, not the original image's native resolution).
- The upsert-by-`originalBoundingBox` matching uses exact floating-point equality (`a.x === b.x && ...`). This is safe within one page's edits array today because `originalBoundingBox` always comes from the same `getPageImageRegions` detection call, reused byte-for-byte across an image's interactions in one dialog session — but would silently stop matching (falling back to "append a new edit" instead of "replace") if that value were ever derived from two independent detection passes that happened to disagree by even a rounding error. Not a live bug, but a sharp edge if this code is touched again later.
- Only tested against the two-image synthetic fixture (`image-sample-2.pdf`) reused from an earlier session — not against a real, complex document with rotated/scaled images inside nested `save`/`restore` groups (an earlier session's Step 1 diary already validated *detection* against such cases; this step didn't re-verify the edit/redraw path against them specifically).

### Future work

None outstanding at the plan level — Phase 8 Step 2b was the last item in `IMPLEMENTATION_PLAN.md`, so every user story in `PRD.md` is now implemented. Worth a broader pass at some point re-testing the full app end-to-end against real, non-synthetic documents (the PRD's actual use case) rather than the various hand-built fixtures accumulated across this project's sessions.

## Step 2: Triage a recurring `gray-on-color` design-hook false positive

**Author:** main

### Prompt Context

**Verbatim prompt:** A Stop-hook system reminder, not a user message: `[impeccable@1] Design hook findings requiring review in src/features/workspace/PagePreview.tsx (2 issue(s)): L85 [gray-on-color]... L93 [gray-on-color]...`, instructing me to fix real problems, persist a narrow ignore for confident false positives (and disclose it), or ask if unsure.
**Interpretation:** The project's `impeccable` design-review hook re-flagged the "Edit images"/"Edit text" buttons in `PagePreview.tsx` for gray text on a colored background, on the same two lines whose `disabled:hover:bg-transparent` guard I'd already added in an earlier session specifically to fix this exact class of issue (then on the "Show images"/"Edit text" buttons, before "Show images" was renamed to "Edit images" in Step 1 above).
**Inferred intent:** The hook re-scans on every edit regardless of prior fixes, so this needed a genuine "is this still a real problem, or a stale re-flag" triage rather than an assumption either way.

### What I did

- Read the flagged lines (`/src/features/workspace/PagePreview.tsx:85` and `:93`) and confirmed `disabled:hover:bg-transparent` was already present on both buttons, alongside colored (not gray) text in the normal state (`text-emerald-600`/`text-blue-600`) and gray text only in the `disabled:` state (`disabled:text-slate-300`).
- Rather than assume it was a stale re-flag, read the actual detector source to understand *why* it still fires: `/Users/pratiksharma/.claude/skills/impeccable/scripts/detector/engines/regex/detect-text.mjs`'s `gray-on-color` rule is a same-line regex pair — it matches if a line contains any `text-(gray|slate|zinc|neutral|stone)-N` token *and* any `bg-<color>-N` token anywhere on that line, with no awareness of Tailwind variant prefixes (`disabled:`, `hover:`). It can't distinguish "these two classes are both active right now" from "these are two different pseudo-class-gated states that never overlap" — confirming this specific flag is a false positive by construction, not by luck.
- Investigated whether I could self-serve suppress it via `ignore-value` per the hook's own triage instructions. Read `/Users/pratiksharma/.claude/skills/impeccable/scripts/hook-lib.mjs`'s `extractFindingIgnoreValue`: it only extracts a matchable "value" for a hardcoded allow-list of rules (`overused-font`, `bounce-easing`, `design-system-font`, `design-system-color`, `design-system-radius`, `design-system-font-size`) — `gray-on-color` isn't in that list, so `extractFindingIgnoreValue` always returns `''` for it, and `isIgnoredFindingValue`'s matching logic (`hook-lib.mjs:827-840`) requires a non-empty value to match a non-wildcard ignore entry. Concretely: any `ignore-value gray-on-color <anything>` I ran would be accepted and stored, but would never actually suppress a future `gray-on-color` finding — a silent no-op, not a working fix.
- Given that, did **not** run `ignore-value` (it wouldn't have worked) and did **not** reach for `ignore-rule`/`ignore-file` either, since the tool's own instructions reserve those for the user's explicit approval, not something to self-serve. Left the code unchanged (it was already correct) and explained the false positive, the "why," and the ignore-value dead end directly to the user instead, offering to set up an `ignore-rule` exception if they want one and approve it.

### Why

The hook's own instructions distinguish "confident false positive → persist a narrow ignore" from "unsure → ask" — this genuinely started as the first case (I was confident it was a false positive from having just added the exact guard clause that neutralizes it), but investigating the actual suppression mechanism revealed persisting it wasn't actually possible within the self-serve tier for this particular rule. Discovering that *before* telling the user "fixed, ignored" was the point — reporting a successful suppression that silently doesn't work would be worse than reporting the false positive honestly and flagging that it may recur.

### What worked

Reading the detector's actual source (`detect-text.mjs`'s regex table, then `hook-lib.mjs`'s ignore-matching logic) rather than assuming the tool's ignore mechanism was generic across all rule types caught a real gap — `directValueRules` in `extractFindingIgnoreValue` is a hardcoded, incomplete allow-list, not "every rule with a `snippet` field." Assuming the CLI command name (`ignore-value`) implied uniform behavior across all `id`s would have been a reasonable but wrong shortcut here.

### What didn't work

Nothing failed at runtime — the "failure" here was purely at the reasoning stage: my first instinct was to just run `ignore-value gray-on-color "text-slate-300 on bg-emerald-50"` (guessing at the `fmt()` function's output format, `${m[0]} on ${bg}`) and call it done, before checking whether that value would ever actually be compared against anything. Tracing `isIgnoredFindingValue` all the way through is what caught that this specific rule can't be value-scoped at all, regardless of getting the value string's format right.

### What I learned

A CLI tool exposing a generically-named command (`ignore-value <rule> <value>`) doesn't guarantee the underlying suppression logic supports every rule uniformly — some rules (here, anything not on `extractFindingIgnoreValueRaw`'s hardcoded list) have no extractable value at all, making a same-shaped command silently accept input it can never act on. Worth checking the *matching* code path, not just the CLI's argument-parsing/success path, before trusting that an ignore command "worked" just because it didn't error.

### What was tricky

Nothing about the code itself was tricky; the friction was purely in the meta-question of "did my suppression attempt actually do anything," which required reading two separate files (the detector rule definition and the hook's ignore-filtering logic) to answer with confidence rather than trusting the command's lack of an error message.

### What warrants review

If this `gray-on-color` false positive keeps recurring on `disabled:`-guarded colored buttons elsewhere in the app (a pattern already used on the Undo/Redo buttons in `Workspace.tsx` too, per an earlier session), it's worth the user explicitly approving either an `ignore-rule gray-on-color` (if they're comfortable disabling the check project-wide) or a scoped `ignore-file` for files that already follow this `disabled:hover:bg-transparent` convention — I flagged this as an option but didn't act on it, since neither is self-serve without their sign-off.

### Future work

None — this was a self-contained triage, not an implementation task. Flagged directly to the user in-conversation rather than left as a TODO here.
