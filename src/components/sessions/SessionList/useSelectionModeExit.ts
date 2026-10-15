/** Akhir otomatis selection mode daftar Session (Esc / daftar kosong). */
import { useEffect } from "react";
import type { SessionListEngine } from "@/hooks/useSessionList";

/**
 * Esc keluar dari selection mode (kecuali ada dialog terbuka — Esc
 * miliknya). Daftar kosong (semua terhapus) juga mengakhiri mode ini.
 */
export function useSelectionModeExit(list: SessionListEngine): void {
  const { selecting, stopSelecting, bulkDeleteOpen, loading } = list;
  const sessionCount = list.sessions.length;
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || bulkDeleteOpen || e.defaultPrevented) return;
      if (document.querySelector("[role=dialog],[role=alertdialog]")) return;
      stopSelecting();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, stopSelecting, bulkDeleteOpen]);
  useEffect(() => {
    if (selecting && !loading && sessionCount === 0) stopSelecting();
  }, [selecting, stopSelecting, loading, sessionCount]);
}
