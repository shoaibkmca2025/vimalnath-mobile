/** Largest photo the preview keeps; edits live in localStorage, which only holds a few megabytes. */
export const MAX_IMAGE_KB = 500;

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Reads a chosen photo as a data URL, or rejects with a message that says how to fix it. */
export function readImageFile(file: File): Promise<string> {
  if (!TYPES.includes(file.type)) return Promise.reject(new Error('Choose a JPG, PNG or WebP image.'));
  if (file.size > MAX_IMAGE_KB * 1024) return Promise.reject(new Error(`That photo is ${Math.round(file.size / 1024)} KB. Choose one under ${MAX_IMAGE_KB} KB.`));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That file couldn’t be read. Try another photo.'));
    reader.readAsDataURL(file);
  });
}
