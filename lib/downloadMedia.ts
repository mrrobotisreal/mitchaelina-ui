// Save a media URL to disk with a sensible filename. Preferred path: fetch the
// bytes and click a same-origin object URL — this works regardless of the
// remote Content-Disposition (presigned S3 GETs, generated-media URLs). If the
// fetch fails (e.g. a cross-origin host without CORS), fall back to opening
// the URL in a new tab so the user can still save it manually.
export async function downloadMedia(url: string, fileName?: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed (${res.status})`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName || inferFileName(url, blob.type);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the click a beat before revoking, or the download can abort.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

// Last path segment if it looks like a filename, else a generic name from the
// MIME subtype (e.g. "download.mp4").
function inferFileName(url: string, mime: string): string {
  try {
    const last = new URL(url, window.location.href).pathname.split('/').pop() ?? '';
    if (last && last.includes('.')) return decodeURIComponent(last);
  } catch {
    // fall through
  }
  const ext = mime.split('/')[1]?.split(';')[0];
  return ext ? `download.${ext}` : 'download';
}
