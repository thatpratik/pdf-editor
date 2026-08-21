# Diary: Interactive image move/resize/delete overlay (Phase 8, Step 2a)

Goal: upgrade Step 1's read-only image-detection overlay into a draggable,
resizable, deletable one — but strictly the interaction UI, with no
`APPLY_IMAGE_EDIT` reducer action and no `buildPdf` wiring yet. This is a
deliberate narrowing of the plan's original Step 2 ("interactive move/resize/
delete + export wiring") into two steps, following the same "prove the
mechanic in isolation before wiring it up" pattern Step 1 used for detection.

## Step 2a: Interactive move/resize/delete (visual only)

**Author:** main

### Prompt Context

**Verbatim prompt:** `/suggest-next-iteration`
**Interpretation:** Ran the skill fresh (new session after `/clear`). Read `PRD.md`, `CONSTITUTION.md`, and `IMPLEMENTATION_PLAN.md`; confirmed Phases 1-7 and Phase 8 Step 1 were already shipped (Step 1's commit landed concurrently, in another session, while this one was running). Since only Phase 8 Step 2 ("Interactive move/resize/delete + export wiring") remained to complete the entire PRD, proposed three options via `AskUserQuestion`: (1) the full Step 2 as originally scoped — interaction UI plus the reducer action and `buildPdf` drawing logic, completing v1 in one iteration; (2) interaction UI only, deferring the reducer/export wiring to a follow-up; (3) first validating `getPageImageRegions` against real-world (non-synthetic) PDFs, per a "what warrants review" note left in Step 1's diary. The user picked option 2.
**Inferred intent:** Same incremental-validation instinct the project has used at every genuinely novel-mechanic step so far (Phase 1's drag-and-drop, Phase 7's text clustering, Phase 8 Step 1's detection): confirm drag/resize/delete feels right as an isolated interaction before committing to the PDF-coordinate conversion, reducer plumbing, and occlude-and-redraw logic that Step 2b will add on top of it.

### What I did

- Rewrote `src/features/workspace/ImageRegionOverlay.tsx` from a static, `pointer-events-none` box-drawing component into a stateful one. Box geometry (`left`, `top`, `width`, `height` in **screen CSS pixels**, not PDF-space units) and a `deleted` flag live in local `useState`, keyed by region id, seeded once from each region's detected PDF-space bounding box via the same `viewport.convertToViewportPoint`/`displayScale` conversion the original read-only overlay already used.
- Drag-to-move and a bottom-right resize handle both use the Pointer Events API (`onPointerDown` → `setPointerCapture` → `onPointerMove`/`onPointerUp` on the same element), rather than any drag library — this is pure "compute a screen-pixel delta, apply it to the pre-drag box," no PDF-space math involved. `setPointerCapture` is what makes the drag/resize handlers keep firing even if the pointer moves off the small box or handle mid-drag, instead of relying on window-level listeners.
- Deliberately kept geometry in screen-space rather than converting to/from PDF coordinates during the drag itself: this step's whole point is validating the interaction, not the coordinate math (Step 1 already validated that separately, and Step 2b's conversion back to PDF-space happens once, at commit time, not on every pointer-move frame).
- A small red "×" button (opacity-0 until the box is hovered, matching the existing `group`/`group-hover` pattern already used elsewhere for hover-revealed controls) sets that region's `deleted` flag; `event.stopPropagation()` on its own `onPointerDown` keeps a delete-button click from also starting a drag on the parent box.
- No changes needed to `PagePreview.tsx` or `imageRegions.ts` — the overlay's external prop contract (`regions`, `viewport`, `displayScale`) is unchanged, so this step is fully contained to the one component.

### Why

Splitting "interaction UI" from "wire it into state/export" mirrors the plan's own Step 1/Step 2 split and the project's now-repeated pattern: a novel interaction mechanic (drag+resize+delete via raw Pointer Events, no prior example of this in the codebase — `PageThumbnail`'s dnd-kit sorting is a different, library-driven interaction) is cheaper to validate visually and interactively before spending effort on the PDF-space conversion, reducer action, and `buildPdf` redraw logic that would sit on top of it. Keeping edit state local and screen-space-only for now also means there's nothing to get wrong yet about undo/redo interaction or stale PDF-space coordinates after a resize — those become real concerns only once Step 2b introduces `APPLY_IMAGE_EDIT`.

### What worked

- `tsc -b` and `eslint .` both passed cleanly on the first attempt.
- Reused the prior session's scratchpad Playwright install and hand-built fixture PDFs (`image-sample-2.pdf`, two images) rather than re-deriving them, and wrote a new interaction script (`test_images4_interact.mjs`) driving real mouse `move`/`down`/`up` sequences against the running dev server:
  - Dragging box 1 by a mouse delta of `(40, 30)` moved its bounding box by exactly `(40, 30)` — confirmed via Playwright's `boundingBox()` before/after, not just a visual glance.
  - Dragging box 2's resize handle by `(50, 25)` grew its box from `68.19×54.55` to `118.19×79.55` — width/height deltas matched the mouse delta exactly.
  - Clicking the delete button on image 1 dropped the overlay's box count from 2 to 1; toggling "Hide images" then "Show images" again restored it to 2, confirming the unmount/remount on toggle naturally resets all interaction state (no explicit "reset" affordance needed).
  - Zero console errors across the whole sequence.
- Screenshots (`shot-6-after-drag.png`, `shot-7-after-resize.png`, `shot-8-after-delete.png`) confirmed the same story visually: the underlying checkerboard-pattern images in the canvas stay fixed in place (expected — this step doesn't touch rendering, only the overlay), while the dashed emerald boxes move/resize/disappear independently on top of them.

### What didn't work

Nothing failed outright. The one thing worth naming: my first instinct was to add window-level `pointermove`/`pointerup` listeners (the common pattern for "drag can go outside the element"), but `setPointerCapture` on the element that received `pointerdown` makes that unnecessary — the same element keeps receiving move/up events regardless of where the pointer travels, as confirmed by the resize-handle test dragging well outside the handle's own tiny 12px hit target without losing the interaction.

### What I learned

Deferring PDF-space conversion entirely for this step — rather than converting on every pointer-move frame just because that's "the real" coordinate system — was the right call for keeping this step's diff small and its behavior easy to verify numerically (screen-pixel deltas in, screen-pixel deltas out, no rounding/rotation-matrix subtlety to account for in the test assertions). That conversion is genuine, real work (Step 1's diary already flagged `Util.applyTransform`'s in-place-mutation gotcha as the kind of thing worth reading source for rather than assuming) and belongs in Step 2b, once there's an actual commit point (drag/resize release) to do it once rather than every frame.

### What was tricky

Making sure the resize handle's own `onPointerDown` didn't also trigger the parent box's move-drag handler: both handlers are bound with the same underlying function (parameterized by `mode: 'move' | 'resize'`), and since the handle is a child of the box in the DOM, a naive implementation would have both fire on the same pointerdown. Calling `event.stopPropagation()` inside the shared handler (before checking which mode it's in) stops the bubble before the parent's own listener sees it — worth calling out because it's easy to add `stopPropagation()` in the wrong handler (e.g. only in a separate resize-specific function) and have it silently not apply when the mode is 'move'.

### What warrants review

- Box geometry is seeded once from `useState`'s lazy initializer and never re-derived from `viewport`/`displayScale` while mounted. If the browser window resizes while "Show images" is active (changing `displayScale` via the existing `ResizeObserver` in `PagePreview.tsx`), the overlay boxes will silently drift out of alignment with the canvas underneath until the user toggles the overlay off and on again. This wasn't fixed because it would require either re-deriving from a `displayScale` ref comparison (added complexity for a step that's explicitly throwaway state) or accepting it as a known limitation until Step 2b, where the box's "real" position becomes PDF-space `newBoundingBox` and screen-space re-derivation on resize would need solving properly anyway.
- As already flagged in Step 1's diary, "Show images" and "Edit text" can both be active simultaneously. Now that the image overlay is interactive (`pointer-events-auto` on each box) rather than fully `pointer-events-none`, a text block and an image box that visually overlap could end up fighting for pointer events depending on DOM order. Not tested here (the fixtures used had no overlapping text+image case) — worth checking once real, mixed-content sample PDFs are used with both modes on.
- No lower/upper bound on drag position or resize size relative to the canvas — a box can be dragged fully off the visible canvas or resized down to `MIN_BOX_SIZE` (16px) but not clamped to any sensible maximum. Left un-clamped deliberately for this validation step; Step 2b should decide whether clamping matters once there's a real "commit" semantic tied to it.

### Future work

Step 2b (tracked as "Not started" in `IMPLEMENTATION_PLAN.md`'s Phase 8 section) adds the `APPLY_IMAGE_EDIT` reducer action, converts Step 2a's screen-space box geometry back to PDF-space via `viewport.convertToPdfPoint` at commit time (drag/resize release, or delete), extracts the image's raw bytes/format from the page's `XObject` resource dictionary, and wires the occlude-then-redraw logic into `buildPdf`. That step should also decide how to reconcile "Show images" and "Edit text" being active together (see above) now that both would be committing real edits rather than one being a no-op preview.
