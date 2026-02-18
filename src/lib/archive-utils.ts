import JSZip from 'jszip';

/**
 * Creates an in-memory zip archive from a map of filenames to content strings.
 * Files are placed inside a root folder named by `archiveName`.
 */
export async function createArchiveFromTextMap(
  files: Map<string, string>,
  archiveName: string = 'archive',
): Promise<Buffer> {
  const zip = new JSZip();
  const folder = zip.folder(archiveName)!;
  for (const [filename, content] of files) {
    folder.file(filename, content);
  }
  return Buffer.from(await zip.generateAsync({type: 'nodebuffer'}));
}

/**
 * Extracts a zip archive buffer into a map of filenames to content strings.
 * Strips the root folder prefix from filenames if present.
 */
export async function extractArchiveToTextMap(data: Buffer): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(data);
  const result = new Map<string, string>();

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    const content = await zipEntry.async('string');
    // Strip the root folder prefix (first segment) from the path
    const parts = relativePath.split('/');
    const cleanPath = parts.length > 1 ? parts.slice(1).join('/') : relativePath;
    result.set(cleanPath, content);
  }

  return result;
}
