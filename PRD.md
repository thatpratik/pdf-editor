## Problem Statement

You and your small team currently juggle multiple free web-based PDF tools to merge, split, reorder, and edit PDFs. This is slow and raises privacy concerns since files get uploaded to third-party sites for routine, frequent PDF chores.

## Solution

A single web-based PDF editor, running fully client-side (files never leave the browser), that covers merge, split, page reordering, and text/image editing in one tool — replacing the ad-hoc tool-hopping.

## User Stories

1. As a team member, I want to merge multiple PDFs into one file, so that I don't need a third-party site to combine documents.
2. As a team member, I want to extract one or more individual pages into their own PDF, so that I can pull out specific content without a separate tool.
3. As a team member, I want to split a PDF into multiple files at chosen page ranges, so that I can divide large documents into logical parts.
4. As a team member, I want to reorder pages via drag-and-drop thumbnails, so that I can fix page order visually and intuitively.
5. As a team member, I want to delete and rotate individual pages, so that I can clean up a document without leaving the tool.
6. As a team member, I want to edit existing text on a page with the surrounding content in that block reflowing naturally, so that I can make corrections without recreating the document.
7. As a team member, I want to move, resize, or delete existing images on a page, so that I can adjust visual content directly in the PDF.
8. As a team member, I want basic undo/redo of my recent actions, so that I can correct mistakes without starting over.

## Implementation Decisions

- All processing happens client-side in the browser; no server upload of files.
- Editing is non-destructive: the original uploaded file is never modified. Edits are applied to a working copy, and a download button produces the finished output when the user is ready.
- Basic undo/redo is included in v1 (undoing/redoing recent actions). Deeper, more extensive history is deferred to v2.
- One unified thumbnail drag-and-drop grid handles both:
  - Multi-file merging — uploading multiple files pools all their pages into one thumbnail view, and dragging pages across file boundaries sets the merge order.
  - Single-file page reordering — the same thumbnail view, showing just that file's pages.
- Split supports both explicit page-range splitting and single-page extraction.
- When a split produces multiple output files, they are delivered zipped together as a single download.
- Text editing supports reflow (in-place word-processor-style editing) contained within the local text block/paragraph being edited — it does not cascade to shift other text or images elsewhere on the page.
- Text editing is limited to modifying content within existing text blocks (corrections, added or removed words/sentences) — it does not support inserting new, freestanding text boxes elsewhere on a page.
- Image editing is limited to moving, resizing, or deleting images that already exist on a page — adding new images is not supported.

## Out of Scope

- Form filling (AcroForms)
- OCR / scanned text recognition
- E-signatures
- User accounts, sharing, or collaboration
- Password-protected or encrypted PDFs
- Page cropping (trimming the visible page boundary) — deferred to v2
- Inserting new freestanding text boxes or new images — not part of v1

## Further Notes

- Intended for a small team's internal daily/weekly PDF workflows, not a public product.
- Success = the team stops reaching for other tools/sites for these tasks.
- Open questions for v2:
  - Whether text reflow should eventually cascade across the full page (shifting other elements when a text block grows/shrinks), rather than staying contained to the edited block.
  - Page cropping behavior (trimming visible page boundaries).
  - More extensive undo/redo (deeper multi-step history) beyond the basic version in v1.
