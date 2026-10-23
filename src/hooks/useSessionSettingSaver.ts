/**
 * Simpan satu perubahan pengaturan Session (`PUT /api/sessions/:id`: model,
 * effort, agent, permission mode) dengan flag `saving` & pesan error —
 * dipakai pemilih model, agent, dan permission mode.
 *
 * - `sessionId` null (composer homepage, Session belum dibuat): tidak ada
 *   PUT; pilihan langsung diterapkan lewat `apply` (dipakai saat membuat
 *   Session).
 * - Satu simpanan sekaligus — klik kedua selama menyimpan diabaikan.
 */
import { useCallback, useRef, useState } from "react";
import { errorText } from "@/lib/api";
import { type SessionSettingsPatch, updateSessionSettings } from "@/lib/session-api";

export interface SessionSettingSaver {
  saving: boolean;
  error: string | null;
  /** Ubah/hapus pesan error (mis. dibagi dengan error pemuatan daftar). */
  setError: (message: string | null) => void;
  /**
   * Kirim `patch` lalu jalankan `apply` bila server menerima; `true` bila
   * sukses. Gagal -> `error` diisi (`errorMessage` bila bukan `ApiError`).
   */
  save: (patch: SessionSettingsPatch, apply: () => void, errorMessage: string) => Promise<boolean>;
}

export function useSessionSettingSaver(sessionId: string | null): SessionSettingSaver {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const save = useCallback(
    async (patch: SessionSettingsPatch, apply: () => void, errorMessage: string) => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setSaving(true);
      setError(null);
      try {
        if (sessionId !== null) await updateSessionSettings(sessionId, patch);
        apply();
        return true;
      } catch (e) {
        setError(errorText(e, errorMessage));
        return false;
      } finally {
        inFlight.current = false;
        setSaving(false);
      }
    },
    [sessionId],
  );

  return { saving, error, setError, save };
}
