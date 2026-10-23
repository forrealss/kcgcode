/**
 * State Preview satu Project: config + status dev server, log, dan URL
 * sekali pakai untuk membuka preview.
 *
 * Status dev server datang realtime lewat WS `preview_status`; polling hanya
 * untuk log selama sheet terbuka (1,5 dtk) dan cadangan bila WS terlewat
 * (30 dtk). URL preview
 * diterbitkan di muka & disegarkan sebelum tiketnya kedaluwarsa, agar tombol
 * Open bisa berupa link biasa (window.open setelah await diblokir di HP).
 */
import { useCallback, useEffect, useState } from "react";
import { useIncrementalLog } from "@/hooks/useIncrementalLog";
import { usePolling } from "@/hooks/usePolling";
import { errorText } from "@/lib/api";
import {
  type DevServerStatus,
  getPreview,
  openPreviewUrl,
  type PreviewConfig,
  previewLogsPath,
  startPreview,
  stopPreview,
} from "@/lib/preview-api";
import { onPreviewStatus } from "@/lib/preview-events";

const FAST_MS = 1500;
const SLOW_MS = 30_000;
/** Tiket server berlaku 60 dtk; segarkan lebih awal. */
const URL_REFRESH_MS = 45_000;
const MAX_LOG_LINES = 300;

export interface UsePreviewResult {
  projectId: string;
  loaded: boolean;
  config: PreviewConfig | null;
  server: DevServerStatus | null;
  logs: string[];
  /** URL siap pakai (hanya saat server running & sheet terbuka). */
  openUrl: string | null;
  /** Ambil URL baru (tiket sekali pakai sudah terpakai). */
  consumeOpenUrl: () => void;
  error: string | null;
  busy: "start" | "stop" | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function usePreview(
  projectId: string,
  sessionId: string | null,
  sheetOpen: boolean,
): UsePreviewResult {
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<PreviewConfig | null>(null);
  const [server, setServer] = useState<DevServerStatus | null>(null);
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [urlNonce, setUrlNonce] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const info = await getPreview(projectId);
      setConfig(info.config);
      setServer(info.server);
      setLoaded(true);
    } catch {
      // Gagal sesaat (jaringan) — biarkan poll berikutnya mencoba lagi.
    }
  }, [projectId]);

  usePolling(refresh, sheetOpen ? FAST_MS : SLOW_MS);

  useEffect(
    () =>
      onPreviewStatus((e) => {
        if (e.projectId === projectId) setServer(e.server);
      }),
    [projectId],
  );

  // Log hanya diambil selama sheet terbuka, saat offset server bertambah.
  // Ganti Project / dev server di-restart (buffer log baru) -> reset log.
  const logs = useIncrementalLog(previewLogsPath(projectId), {
    enabled: sheetOpen,
    offset: server?.logOffset ?? 0,
    resetKey: server?.startedAt ?? 0,
    max: MAX_LOG_LINES,
  });

  const running = server?.phase === "running";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `urlNonce` memicu tiket baru setelah dipakai
  useEffect(() => {
    if (!sheetOpen || !running) {
      setOpenUrl(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      openPreviewUrl(projectId, sessionId).then(
        (url) => {
          if (!cancelled) setOpenUrl(url);
        },
        (e) => {
          if (!cancelled) setError(errorText(e, "Couldn't open the preview"));
        },
      );
    void load();
    const id = setInterval(() => void load(), URL_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [projectId, sessionId, sheetOpen, running, urlNonce]);

  const consumeOpenUrl = useCallback(() => {
    // Biarkan navigasi memakai tiket ini dulu, lalu minta yang baru.
    setTimeout(() => setUrlNonce((n) => n + 1), 500);
  }, []);

  const start = useCallback(async () => {
    setBusy("start");
    setError(null);
    try {
      setServer(await startPreview(projectId));
    } catch (e) {
      setError(errorText(e, "Couldn't start the dev server"));
    } finally {
      setBusy(null);
    }
  }, [projectId]);

  const stop = useCallback(async () => {
    setBusy("stop");
    setError(null);
    try {
      await stopPreview(projectId);
      await refresh();
    } catch (e) {
      setError(errorText(e, "Couldn't stop the dev server"));
    } finally {
      setBusy(null);
    }
  }, [projectId, refresh]);

  return {
    projectId,
    loaded,
    config,
    server,
    logs,
    openUrl,
    consumeOpenUrl,
    error,
    busy,
    start,
    stop,
  };
}
