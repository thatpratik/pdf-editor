import { useState } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import type { TextBlock } from '../../lib/textBlocks'

interface TextEditOverlayProps {
  blocks: TextBlock[]
  viewport: PageViewport
  /** Backing-store-pixels-to-displayed-CSS-pixels ratio for the canvas underneath this overlay. */
  displayScale: number
  onCommit: (block: TextBlock, newText: string) => void
}

/**
 * Floor on the *focused* edit box's font size, in CSS pixels. Typical PDF
 * body text renders down around 10-13px at this app's preview scale —
 * legible to read but cramped to click into and type in. Only the currently
 * focused block gets this treatment (see below); every other block renders
 * at its true, unmodified size so the page keeps looking exactly like the
 * source document until the user actually clicks into something.
 */
const MIN_EDIT_FONT_PX = 15

/**
 * One absolutely-positioned, contentEditable box per detected text block,
 * layered on top of the already-rendered page canvas. Sized/positioned by
 * converting each block's PDF-space bounding box through the same viewport
 * `renderPageToCanvas` used, so the boxes line up with the real text under
 * them. The browser's own text-wrapping inside each fixed-width box is what
 * shows the user live reflow as they type — the actual pdf-lib redraw
 * happens later, at download time.
 *
 * Only the currently focused block is visually "popped out" (opaque
 * background, border, floor on font size, raised above its neighbors, and
 * its actual text made visible). Every other block renders with fully
 * transparent text and no fill — a click target sitting over the untouched
 * canvas, not a visible duplicate of it. This split exists for two reasons
 * discovered against a real, densely-packed document (a multi-row form):
 * enlarging every block's font at once made them all collide into an
 * unreadable, "scrambled" mess and covered up the surrounding non-text
 * layout (table lines, alignment) that gives the page its context; and,
 * independently, the browser's own line-wrapping inside a multi-line block
 * doesn't reliably reproduce pdf.js's original per-line vertical rhythm, so
 * a *visible* unfocused overlay text would drift out of alignment with the
 * matching canvas pixels underneath as a block gets taller — visible as
 * doubled, ghosted text. Keeping unfocused text invisible sidesteps that
 * misalignment entirely rather than trying to make it pixel-perfect.
 */
export function TextEditOverlay({
  blocks,
  viewport,
  displayScale,
  onCommit,
}: TextEditOverlayProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null)

  return (
    <div className="pointer-events-none absolute inset-0">
      {blocks.map((block) => {
        const [x1, y1] = viewport.convertToViewportPoint(block.boundingBox.x, block.boundingBox.y)
        const [x2, y2] = viewport.convertToViewportPoint(
          block.boundingBox.x + block.boundingBox.width,
          block.boundingBox.y + block.boundingBox.height,
        )
        const left = Math.min(x1, x2) * displayScale
        const top = Math.min(y1, y2) * displayScale
        const width = Math.abs(x2 - x1) * displayScale
        const height = Math.abs(y2 - y1) * displayScale
        const naturalFontSize = block.fontSize * viewport.scale * displayScale
        const isFocused = focusedId === block.id
        const fontSize = isFocused ? Math.max(naturalFontSize, MIN_EDIT_FONT_PX) : naturalFontSize

        return (
          <div
            key={block.id}
            contentEditable
            suppressContentEditableWarning
            onFocus={() => setFocusedId(block.id)}
            onBlur={(event) => {
              onCommit(block, event.currentTarget.innerText)
              setFocusedId((current) => (current === block.id ? null : current))
            }}
            style={{
              left,
              top,
              width,
              minHeight: height,
              fontSize,
              lineHeight: isFocused ? 1.3 : 1.15,
              zIndex: isFocused ? 10 : 0,
            }}
            className={`pointer-events-auto absolute px-0.5 whitespace-pre-wrap outline-none ${
              isFocused
                ? 'overflow-visible border border-dashed border-blue-600 bg-white text-slate-900 shadow-lg'
                : 'overflow-hidden border border-transparent text-transparent hover:border-dashed hover:border-blue-300 hover:bg-blue-50/30'
            }`}
          >
            {block.text}
          </div>
        )
      })}
    </div>
  )
}
