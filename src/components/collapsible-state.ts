/**
 * State collapsible thinking block per pesan (Requirement 8.3).
 *
 * Logika murni dan bebas DOM agar dapat diuji dengan property test
 * (Property 25) lewat `bun test` tanpa rendering React.
 *
 * Representasi `Record<messageId, boolean>` dijaga aman terhadap key khusus
 * prototipe (`__proto__`, `toString`, dst.): seluruh baca/tulis memakai
 * own-property eksplisit sehingga id pesan apa pun (hasil generator property
 * test) tidak mencemari prototipe objek state.
 */
export type CollapsibleState = Record<string, boolean>;

/** Definisikan key sebagai own-property enumerable (aman untuk `__proto__`). */
function setOwn(state: CollapsibleState, key: string, value: boolean): void {
  Object.defineProperty(state, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** State awal: seluruh pesan tampil (expanded) sebelum toggle pertama (Req 8.3). */
export function initialCollapsibleState(messageIds: readonly string[]): CollapsibleState {
  const state: CollapsibleState = {};
  for (const id of messageIds) setOwn(state, id, true);
  return state;
}

/** Status tampil saat ini untuk sebuah pesan (default: expanded, Req 8.3). */
export function isCollapsibleExpanded(state: CollapsibleState, messageId: string): boolean {
  if (Object.hasOwn(state, messageId)) {
    return Boolean(state[messageId]);
  }
  return true;
}

/**
 * Toggle satu pesan tanpa memengaruhi pesan lain (Property 25).
 * Mengembalikan state baru (immutable) agar mudah diverifikasi.
 */
export function toggleCollapsible(state: CollapsibleState, messageId: string): CollapsibleState {
  const next: CollapsibleState = {};
  for (const [key, value] of Object.entries(state)) setOwn(next, key, value);
  setOwn(next, messageId, !isCollapsibleExpanded(state, messageId));
  return next;
}
