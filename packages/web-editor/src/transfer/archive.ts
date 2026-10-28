import { unzipSync } from 'fflate';
/** Inspect central-directory sizes before a ZIP/XLSX decoder allocates expanded content. */
export function inspectArchive(bytes: Uint8Array) {
  if (bytes.length > 100 * 1024 * 1024) throw new Error('Archive too large');
  const paths = new Set<string>();
  let total = 0;
  unzipSync(bytes, {
    filter: (entry) => {
      total += entry.originalSize;
      if (
        entry.name.startsWith('/') ||
        entry.name.includes('\\') ||
        entry.name.includes('\0') ||
        entry.name.split('/').includes('..') ||
        paths.has(entry.name) ||
        total > 200 * 1024 * 1024 ||
        paths.size >= 10000
      )
        throw new Error('Invalid archive');
      paths.add(entry.name);
      return false;
    },
  });
}
