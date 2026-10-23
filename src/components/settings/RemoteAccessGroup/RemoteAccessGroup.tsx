/**
 * Grup Settings "Remote access": tunnel publik `https://<name>.<domain>`.
 *
 * Alur UI (device authorization): Get started -> tampil kode + tautan/QR ->
 * pengguna login Google & menyetujui di halaman API tunnel (boleh
 * dari HP) -> kcgcode tersambung dan tunnel langsung menyala. Status di-poll
 * dari `/api/tunnel`; token & secret tidak pernah dikirim ke browser.
 *
 * Bahasa UI sengaja non-teknis (tanpa "tunnel", "secret", "frpc"): istilah
 * teknis & aksi jarang dipakai disimpan di bagian "Advanced" yang tertutup.
 *
 * Susunan halaman (satu hal per grup, ringkas di HP):
 * 1. AdwSwitchRow "Remote access" + status satu frasa.
 * 2. "Your link" (saat online): QR (desktop), baris link + salin/buka;
 *    di HP: "Share link" + QR dilipat di baris expander.
 * 3. Akun Google tertaut.
 * 4. "Connection method" (pilihan penyedia — jarang diganti, jadi di bawah).
 * 5. "Advanced options" tertutup.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { type TunnelOverview, useTunnelStatus } from "@/hooks/useTunnelStatus";
import { apiFetch, errorText } from "@/lib/api";
import { ConfirmDialog } from "./ConfirmDialog";
import { KcgRemoteAccess } from "./KcgRemoteAccess";
import { LhrRemoteAccess } from "./LhrRemoteAccess";
import { type Provider, ProviderPicker, SwitchDialog } from "./ProviderPicker";
import { LoadingGroup } from "./rows";
import { sameOrigin } from "./utils";

const DESCRIPTION = "Open KCG Code from your phone or another computer, even when you're away.";

/** Ringkasan status kedua penyedia untuk kartu pilihan (bukan detail panel). */
interface ProviderOverview {
  provider: Provider;
  /** URL publik penyedia yang sedang menyala, null bila tidak ada. */
  liveUrl: string | null;
  live: Provider | null;
}

function readOverview(b: TunnelOverview): ProviderOverview {
  const kcgOn = !!b.tunnel && b.tunnel.enabled && b.tunnel.phase !== "stopped";
  const lhrOn = !!b.lhr && b.lhr.enabled && b.lhr.phase !== "stopped";
  const live: Provider | null = kcgOn ? "kcg" : lhrOn ? "lhr" : null;
  return {
    provider: b.provider === "lhr" ? "lhr" : "kcg",
    live,
    liveUrl:
      live === "kcg"
        ? (b.tunnel?.account?.url ?? null)
        : live === "lhr"
          ? (b.lhr?.url ?? null)
          : null,
  };
}

/**
 * Pembungkus Remote access: pemilih penyedia (KCG Code bawaan / localhost.run)
 * lalu panel penyedia terpilih. Hanya satu tunnel aktif — berpindah
 * penyedia mematikan yang lain di server (`PUT /api/tunnel/provider`).
 */
export function RemoteAccessGroup({ protectedApp }: { protectedApp: boolean }) {
  const [provider, setProvider] = useState<Provider | null>(null);
  // Status "On" di kartu ikut berubah saat tunnel dinyalakan/dimatikan di panel
  // (poll bersama dengan panel penyedia bawaan).
  const tunnel = useTunnelStatus();
  const overview = tunnel.data ? readOverview(tunnel.data) : null;
  const live = { provider: overview?.live ?? null, url: overview?.liveUrl ?? null };
  const [switching, setSwitching] = useState(false);
  /** Pindah penyedia saat yang lain menyala -> minta konfirmasi dulu. */
  const [pendingSwitch, setPendingSwitch] = useState<Provider | null>(null);
  /** Konfirmasi mematikan localhost.run (dialog yang sama dengan penyedia bawaan). */
  const [lhrStop, setLhrStop] = useState<{ run: () => Promise<void>; via: boolean } | null>(null);
  const [lhrStopping, setLhrStopping] = useState(false);

  const { refresh: refreshTunnel } = tunnel;
  const refresh = useCallback(async (): Promise<ProviderOverview | null> => {
    const body = await refreshTunnel();
    return body ? readOverview(body) : null;
  }, [refreshTunnel]);

  useEffect(() => {
    let cancelled = false;
    void refresh().then((o) => {
      if (!cancelled) setProvider((cur) => cur ?? o?.provider ?? "kcg");
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const applySwitch = async (next: Provider) => {
    setSwitching(true);
    try {
      await apiFetch("/api/tunnel/provider", {
        method: "PUT",
        body: JSON.stringify({ provider: next }),
      });
      setProvider(next);
      await refresh();
    } catch (e) {
      toast.error(errorText(e, "Couldn't switch the remote access option."));
    } finally {
      setSwitching(false);
      setPendingSwitch(null);
    }
  };

  const choose = async (next: Provider) => {
    if (next === provider || switching) return;
    // Status terbaru: jangan mematikan tunnel yang menyala tanpa bertanya.
    const o = await refresh();
    if (o?.live && o.live !== next) setPendingSwitch(next);
    else void applySwitch(next);
  };

  // Pilihan penyedia dirender panel penyedia di posisinya (sebelum Advanced).
  const methodPicker = (
    <ProviderPicker
      value={provider}
      live={live.provider}
      disabled={switching}
      onChange={(p) => void choose(p)}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="px-1 text-[13px] leading-snug text-muted-foreground">{DESCRIPTION}</p>
      <SwitchDialog
        to={pendingSwitch}
        viaTunnel={live.url !== null && sameOrigin(live.url)}
        busy={switching}
        onCancel={() => setPendingSwitch(null)}
        onConfirm={(p) => void applySwitch(p)}
      />
      {provider === null ? (
        <LoadingGroup />
      ) : provider === "lhr" ? (
        <LhrRemoteAccess
          protectedApp={protectedApp}
          onRequestStop={(run, via) => setLhrStop({ run, via })}
          methodPicker={methodPicker}
        />
      ) : (
        <KcgRemoteAccess protectedApp={protectedApp} methodPicker={methodPicker} />
      )}
      <ConfirmDialog
        kind={lhrStop ? "stop" : null}
        viaTunnel={lhrStop?.via ?? false}
        busy={lhrStopping}
        onOpenChange={(open) => !open && setLhrStop(null)}
        onConfirm={() => {
          const job = lhrStop;
          if (!job) return;
          setLhrStopping(true);
          void job.run().finally(() => {
            setLhrStopping(false);
            setLhrStop(null);
            void refresh();
          });
        }}
      />
    </div>
  );
}
