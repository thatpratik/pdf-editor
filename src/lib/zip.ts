import { downloadZip } from 'client-zip'

/**
 * Bundles multiple named PDF byte arrays into one zip Blob for download.
 * `client-zip` stores rather than compresses by default, which is correct
 * here since PDF bytes are already binary/incompressible.
 */
export async function zipPdfs(parts: { name: string; bytes: Uint8Array }[]): Promise<Blob> {
  return downloadZip(parts.map((part) => ({ name: part.name, input: part.bytes }))).blob()
}
