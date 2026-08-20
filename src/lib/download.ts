/**
 * Triggers a browser download of a Blob via a detached, programmatically
 * clicked `<a download>`, revoking the object URL on the next tick. Shared
 * by both single-PDF (`pdfExport.ts`) and zipped multi-file (`zip.ts`)
 * downloads, since both ultimately just need to hand the browser a Blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()

  setTimeout(() => URL.revokeObjectURL(url), 0)
}
