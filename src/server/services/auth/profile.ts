/**
 * Profil pemilik (nama panggilan, foto/avatar bawaan) dan preferensi kunci
 * otomatis. Semua input divalidasi di sini sebelum disimpan.
 */
import type { SessionStore } from "../../../db";
import { isAvatarPresetId } from "../../../lib/avatar-presets";
import type { AuthSettings } from "../../db/auth";
import type { Result } from "../../result";
import {
  AUTO_LOCK_CHOICES,
  type AuthProfile,
  AVATAR_MAX_BYTES,
  AVATAR_MIMES,
  NICKNAME_MAX,
} from "./types";
import { sniffImageMime } from "./validation";

export interface ProfileOpsDeps {
  store: SessionStore;
  now: () => number;
  settings: () => AuthSettings;
}

export function createProfileOps(deps: ProfileOpsDeps) {
  const { store, now, settings } = deps;

  function profile(): AuthProfile {
    const s = settings();
    return {
      nickname: s.nickname,
      avatarUrl: s.avatarMime ? `/api/auth/avatar?v=${s.avatarVersion}` : null,
      // Preset yang tidak dikenal lagi (katalog berubah) diabaikan.
      avatarPreset: !s.avatarMime && isAvatarPresetId(s.avatarPreset) ? s.avatarPreset : null,
    };
  }

  function setNickname(nickname: string | null): Result<AuthProfile> {
    const clean = nickname === null ? null : nickname.replace(/\s+/g, " ").trim();
    if (clean !== null && clean.length > NICKNAME_MAX) {
      return { ok: false, error: "NICKNAME_TOO_LONG" };
    }
    // Karakter kontrol ditolak (nama tampil di lock screen).
    // biome-ignore lint/suspicious/noControlCharactersInRegex: memang menyaring kontrol
    if (clean !== null && /[\u0000-\u001f\u007f]/.test(clean)) {
      return { ok: false, error: "NICKNAME_INVALID" };
    }
    store.setAuthNickname(clean === "" ? null : clean, now());
    return { ok: true, data: profile() };
  }

  function setAvatar(bytes: Uint8Array | null, mime: string | null): Result<AuthProfile> {
    if (bytes === null) {
      store.setAuthAvatar(null, null, now());
      return { ok: true, data: profile() };
    }
    if (bytes.length === 0) return { ok: false, error: "EMPTY_UPLOAD" };
    if (bytes.length > AVATAR_MAX_BYTES) return { ok: false, error: "AVATAR_TOO_LARGE" };
    const sniffed = sniffImageMime(bytes);
    // Tipe berdasarkan isi file; MIME client hanya pelengkap.
    if (!sniffed || (mime !== null && mime !== "" && !AVATAR_MIMES.includes(mime as never))) {
      return { ok: false, error: "UNSUPPORTED_IMAGE_MIME" };
    }
    store.setAuthAvatar(bytes, sniffed, now());
    return { ok: true, data: profile() };
  }

  function setAvatarPreset(preset: string): Result<AuthProfile> {
    if (!isAvatarPresetId(preset)) return { ok: false, error: "AVATAR_PRESET_INVALID" };
    store.setAuthAvatarPreset(preset, now());
    return { ok: true, data: profile() };
  }

  function setAutoLock(minutes: number): Result<number> {
    if (!AUTO_LOCK_CHOICES.includes(minutes as never)) {
      return { ok: false, error: "AUTO_LOCK_INVALID" };
    }
    store.setAuthAutoLock(minutes, now());
    return { ok: true, data: minutes };
  }

  return { profile, setNickname, setAvatar, setAvatarPreset, setAutoLock };
}
