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
 * One absolutely-positioned, contentEditable box per detected text block,
 * layered on top of the already-rendered page canvas. Sized/positioned by
 * converting each block's PDF-space bounding box through the same viewport
 * `renderPageToCanvas` used, so the boxes line up with the real text under
 * them. The browser's own text-wrapping inside each fixed-width box is what
 * shows the user live reflow as they type — the actual pdf-lib redraw
 * happens later, at download time.
 */
export function TextEditOverlay({
  blocks,
  viewport,
  displayScale,
  onCommit,
}: TextEditOverlayProps) {
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
        const fontSize = block.fontSize * viewport.scale * displayScale

        return (
          <div
            key={block.id}
            contentEditable
            suppressContentEditableWarning
            onBlur={(event) => onCommit(block, event.currentTarget.innerText)}
            style={{ left, top, width, minHeight: height, fontSize, lineHeight: 1.15 }}
            className="pointer-events-auto absolute overflow-visible border border-dashed border-blue-400 bg-white/90 px-0.5 whitespace-pre-wrap outline-none focus:border-blue-600 focus:bg-white"
          >
            {block.text}
          </div>
        )
      })}
    </div>
  )
}
