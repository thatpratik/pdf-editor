## Language & Runtime

TypeScript, running on Vite + React (no Next.js — no server rendering or API routes needed since all processing is client-side).

## Architecture Principles

- All PDF processing happens client-side in the browser — no server upload of files, per the PRD's privacy requirement.
- pdf.js renders pages to canvas for thumbnails/previews; `@pdfme/pdf-lib` performs document mutation (merge, split, reorder, delete, rotate).
- In-place text/image editing has no off-the-shelf solution. Intended approach: overlay an editable layer on pdf.js's extracted text/image positions, redact the original content in that region, then regenerate the content stream for just that block via pdf-lib — reflow stays confined to the local block. Detailed design is deferred until that feature is actively built.
- Organize code by feature (merge, split, reorder, editor) rather than generic layers.
- Keep state in React component state/context; avoid global state libraries (Redux, Zustand) unless a real need emerges.

## Fixed Dependencies

- Vite
- React
- TypeScript
- ESLint + Prettier
- Tailwind for frontend
- pdf.js (`pdfjs-dist`) — rendering/thumbnails
- `@pdfme/pdf-lib` — page manipulation
- dnd-kit — drag-and-drop reordering
- client-zip — zip bundling for split output
