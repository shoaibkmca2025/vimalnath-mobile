import { ApiError, UNREACHABLE } from './api';

export const MAX_IMAGE_MB = 5;
export const MAX_PDF_MB = 25;

/**
 * Uploads one photo or PDF and resolves with its address. XMLHttpRequest rather than fetch, because only it
 * reports upload progress, which a 25 MB price list on shop Wi-Fi needs.
 */
export function upload(file: File, onProgress?: (share: number) => void): Promise<string> {
  const limit = file.type === 'application/pdf' ? MAX_PDF_MB : MAX_IMAGE_MB;
  if (file.size > limit * 1024 * 1024) return Promise.reject(new ApiError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Choose one under ${limit} MB.`));
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/v1/admin/media');
    request.setRequestHeader('Content-Type', file.type);
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    request.responseType = 'json';
    request.upload.onprogress = (event) => event.lengthComputable && onProgress?.(event.loaded / event.total);
    request.onerror = () => reject(new ApiError(UNREACHABLE));
    request.onload = () => {
      // Signed out mid-use: as in api(), reloading leads to sign-in and back here.
      if (request.status === 401) window.location.reload();
      const data = request.response as { url?: string; error?: { message?: string } } | null;
      if (request.status === 201 && data?.url) resolve(data.url);
      else reject(new ApiError(data?.error?.message ?? UNREACHABLE));
    };
    request.send(file);
  });
}

/** The smaller copy the server makes of an uploaded photo; the app's built-in photos come in one size. */
export const sized = (src: string, size: 'sm' | 'md') => src.replace(/^(\/v1\/media\/[a-f0-9]{24})\.webp$/, `$1-${size}.webp`);
