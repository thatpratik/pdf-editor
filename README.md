# PDF Editor

A single web-based PDF editor for merging, splitting, reordering, and editing PDFs — built for a small team's daily PDF chores so they can stop tool-hopping across third-party sites.

**Everything runs client-side.** Files never leave the browser — no server upload, ever. That's the whole point.

## Features

- **Merge** — upload multiple PDFs and pool all their pages into one thumbnail grid; drag pages across file boundaries to set the merge order.
- **Reorder** — drag-and-drop any page, including across the files it came from.
- **Delete & rotate** individual pages.
- **Extract** one or more selected pages into their own PDF.
- **Split** a document into multiple files at chosen page breaks; multi-file output is delivered as a single zip.
- **Edit text in place** — click into an existing text block and edit it; the browser reflows the text live, confined to that block.
- **Move, resize, or delete images** that already exist on a page.
- **Undo/redo** for recent actions.
- **Light/dark theme**, switchable from the header.

Non-destructive by design: the original uploaded file is never modified. Edits build up on a working copy, and Download produces the finished output on demand.

### Known limitations

- Editing text or images visually covers the original content rather than removing it from the PDF's underlying data — the app surfaces this in-app the first time you use either editor.
- Edited text uses the closest standard font (Helvetica/Times family), not the document's original embedded font.
- Out of scope: form filling, OCR, e-signatures, accounts/collaboration, encrypted PDFs, and page cropping.

See `PRD.md` for the full product spec and `IMPLEMENTATION_PLAN.md` for how each feature was built.

## Tech stack

- [Vite](https://vite.dev) + [React](https://react.dev) + TypeScript
- [Tailwind CSS](https://tailwindcss.com) v4 for styling, with a CSS-variable-driven light/dark theme
- [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) for rendering pages to canvas and reading text/image positions
- [`@pdfme/pdf-lib`](https://github.com/pdfme/pdf-lib) for document mutation (merge, split, rotate, delete, drawing edits)
- [dnd-kit](https://dndkit.com) for drag-and-drop page reordering
- [client-zip](https://github.com/Touffy/client-zip) for bundling split output into one download

## Getting started

```bash
npm install
npm run dev       # start the dev server
```

Other scripts:

```bash
npm run build      # type-check and build for production
npm run preview    # preview the production build locally
npm run lint        # run ESLint
npm run format      # run Prettier
```

## Project structure

```
src/
  lib/                    pdf.js wrapper, pdf-lib export pipeline, zip bundling,
                           text-block/image-region detection
  features/workspace/     the whole app: upload, thumbnail grid, page preview,
                           text/image edit dialogs, undo/redo, theme toggle
```

`docs/diary/` has a written log of how each feature was built, including the trickier parts (in-place text reflow, image detection from pdf.js's operator list, etc.).
