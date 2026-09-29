/**
 * Katalog avatar bawaan (preset). Dibagi server & FE:
 * - Server hanya memvalidasi id (`isAvatarPresetId`) — tidak mengimpor ikon.
 * - FE memetakan id -> ikon lucide + warna di `components/auth/avatar-icons.tsx`.
 *
 * Menambah preset: tambahkan id di sini DAN pemetaannya di FE (dijaga test).
 */
export const AVATAR_PRESET_IDS = [
  "cat",
  "dog",
  "rabbit",
  "panda",
  "bird",
  "fish",
  "turtle",
  "squirrel",
  "rocket",
  "bot",
  "ghost",
  "gamepad",
  "flower",
  "leaf",
  "mountain",
  "coffee",
] as const;

export type AvatarPresetId = (typeof AVATAR_PRESET_IDS)[number];

export function isAvatarPresetId(v: unknown): v is AvatarPresetId {
  return typeof v === "string" && (AVATAR_PRESET_IDS as readonly string[]).includes(v);
}
