export class MediaImageError extends Error {
  constructor(public code: 'format' | 'size' | 'decode' | 'url') {
    super(code);
  }
}
export async function validateImageUrl(url: string) {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new MediaImageError('decode');
  }
  return url;
}
export async function validateImageFile(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))
    throw new MediaImageError('format');
  if (file.size > 10 * 1024 * 1024) throw new MediaImageError('size');
  const url = URL.createObjectURL(file);
  try {
    await validateImageUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
