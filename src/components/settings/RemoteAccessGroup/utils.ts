/** `true` bila halaman ini sedang dibuka lewat alamat tunnel. */
export function sameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}
