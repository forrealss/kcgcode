/**
 * Pencarian skills.sh untuk tab Browse halaman Skills: debounce, minimal
 * `MIN_QUERY` karakter, respon usang dibuang. Hasil lama tetap tampil selama
 * query baru dimuat (`busy` -> spinner di kolom cari).
 */
import { useEffect, useState } from "react";
import { apiFetch, errorText } from "@/lib/api";
import type { IdleLoad } from "@/lib/load-state";
import type { RegistrySkill } from "@/server/services/skills-registry";

/** Jeda ketik sebelum memanggil skills.sh. */
const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY = 2;

export interface SkillSearch {
  results: IdleLoad<RegistrySkill[]>;
  /** Permintaan pencarian sedang berjalan (hasil lama tetap tampil). */
  busy: boolean;
  /** Query cukup panjang untuk dicari. */
  canSearch: boolean;
}

/** `query` = isi kolom cari tab Browse (belum di-trim). */
export function useSkillSearch(query: string): SkillSearch {
  const [results, setResults] = useState<IdleLoad<RegistrySkill[]>>({ phase: "idle" });
  const [busy, setBusy] = useState(false);
  const trimmed = query.trim();
  const canSearch = trimmed.length >= MIN_QUERY;
  useEffect(() => {
    if (!canSearch) {
      setResults({ phase: "idle" });
      setBusy(false);
      return;
    }
    let cancelled = false;
    setResults((prev) => (prev.phase === "ready" ? prev : { phase: "loading" }));
    setBusy(true);
    const timer = setTimeout(() => {
      apiFetch(`/api/skills/search?${new URLSearchParams({ q: trimmed })}`)
        .then((res) => res.json() as Promise<{ skills: RegistrySkill[] }>)
        .then(({ skills }) => {
          if (!cancelled) setResults({ phase: "ready", data: skills });
        })
        .catch((e) => {
          if (!cancelled) setResults({ phase: "error", message: errorText(e, "Search failed") });
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, canSearch]);
  return { results, busy, canSearch };
}
