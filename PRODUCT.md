# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A small team's internal daily/weekly PDF workflows. Team members currently juggle multiple free web-based PDF tools to merge, split, reorder, and edit PDFs — this product replaces that ad-hoc tool-hopping. Not a public product; no broader audience is targeted.

## Product Purpose

A single web-based PDF editor covering merge, split, page reordering, and text/image editing in one tool. It exists because tool-hopping across third-party sites for routine PDF chores is slow and raises privacy concerns (files get uploaded to sites the team doesn't control). Success means the team stops reaching for other tools/sites for these tasks.

## Positioning

All processing happens fully client-side in the browser — files never leave the device. A neighboring free web-based PDF tool could not truthfully copy this claim, since most such tools require server upload. This is the product's core differentiator, not merely a feature.

## Operating Context

- Editing is non-destructive: the original uploaded file is never modified. Edits apply to a working copy; a download button produces the finished output when the user is ready.
- One unified thumbnail drag-and-drop grid handles both multi-file merging (pooling pages from multiple uploads into one ordering view) and single-file page reordering.
- Split supports explicit page-range splitting and single-page extraction; multi-file split output is delivered zipped as one download.
- Text editing is in-place, word-processor-style reflow contained within the local text block/paragraph being edited — it does not cascade to shift other text or images elsewhere on the page, and it does not support inserting new freestanding text boxes.
- Image editing covers moving, resizing, or deleting images that already exist on a page — adding new images is not supported.
- Basic undo/redo of recent actions is included; deeper multi-step history is deferred.

## Capabilities and Constraints

- Confirmed v1 capabilities: merge, split (range + single-page extraction), drag-and-drop reorder, delete/rotate pages, in-place text editing with local-block reflow, image move/resize/delete, basic undo/redo.
- Explicitly out of scope: form filling (AcroForms), OCR/scanned text recognition, e-signatures, user accounts/sharing/collaboration, password-protected or encrypted PDFs, page cropping (deferred to v2), inserting new freestanding text boxes or new images.
- Open v2 questions (undecided, not to be treated as commitments): whether text reflow should eventually cascade across the full page, page cropping behavior, deeper multi-step undo/redo history.
- Technical constraints: pdf.js (`pdfjs-dist`) renders pages to canvas for thumbnails/previews; `@pdfme/pdf-lib` performs document mutation (merge, split, reorder, delete, rotate); in-place text/image editing overlays an editable layer on pdf.js-extracted positions, redacts the original region, and regenerates the content stream for just that block via pdf-lib, keeping reflow confined to the local block.

## Evidence on Hand

None. No testimonials, case studies, or usage data exist; future work must not fabricate any.

## Product Principles

- Privacy by architecture: no file ever leaves the browser, in any feature, at any point — this is a constraint on every future capability, not just a current one.
- Non-destructive editing: the working copy is always disposable; the original is never mutated in place.
- Contained edits over cascading ones: text/image edits stay local to the block or element touched, rather than reflowing or shifting the rest of the page.
- One unified surface: merge and reorder share the same thumbnail grid rather than being separate flows, and split output that produces multiple files is delivered as a single zipped download.
- Scope discipline: v1 deliberately excludes forms, OCR, e-signatures, accounts/collaboration, and encrypted-PDF support — depth on the core chores over breadth of PDF features.

## Accessibility & Inclusion

Standard keyboard navigation is expected; no additional formal accessibility standard (e.g. WCAG) or specific user need has been established.
