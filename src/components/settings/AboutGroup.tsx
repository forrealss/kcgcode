/**
 * Settings -> About: logo + versi KCG Code, lalu kredit tim.
 *
 * Versi dari `GET /api/meta` — `"dev"` saat dijalankan lewat `bun dev`.
 * Tiap anggota tim adalah baris tautan ke profil GitHub-nya (tab baru).
 */
import type * as React from "react";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AppInfo } from "@/server/services/app-info";
import logo from "../../logo.svg";

export interface TeamMember {
  /** Username GitHub (tanpa `@`). */
  username: string;
  role: string;
}

export const TEAM: readonly TeamMember[] = [
  { username: "irsyadulibad", role: "Lead Developer" },
  { username: "sahrullahh", role: "Product Advisor" },
];

export function githubUrl(username: string): string {
  return `https://github.com/${encodeURIComponent(username)}`;
}

/** Teks versi untuk ditampilkan: `"dev"` apa adanya, semver diberi `v`. */
export function formatVersion(version: string): string {
  return version === "dev" ? "dev" : `v${version}`;
}

export function AboutGroup() {
  const [version, setVersion] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch("/api/meta");
        const info = (await res.json()) as AppInfo;
        if (!cancelled) setVersion(info.version);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <AboutView version={version} failed={failed} />;
}

/** Tampilan murni (tanpa fetch) — dipakai komponen di atas & diuji SSR. */
export function AboutView({ version, failed }: { version: string | null; failed: boolean }) {
  return (
    <>
      {/* Hero: kartu netral dengan SATU cahaya lembut dari atas (warna logo,
          opasitas rendah) + garis highlight tipis di tepi atas. Sengaja
          tanpa pola titik, blob blur, teks gradien, atau animasi — aksen
          cukup satu, sisanya tipografi & ruang kosong. */}
      <section
        aria-labelledby="about-title"
        className="relative isolate overflow-hidden rounded-3xl border bg-card px-6 pt-12 pb-9 text-center shadow-xs"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_55%_at_50%_0%,rgba(109,92,251,0.09),transparent_70%)] dark:bg-[radial-gradient(70%_55%_at_50%_0%,rgba(109,92,251,0.16),transparent_70%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-[#6D5CFB]/45 to-transparent"
        />

        <div className="flex flex-col items-center">
          <span className="flex size-24 items-center justify-center rounded-[1.75rem] border bg-background p-5 shadow-sm sm:size-28">
            <img src={logo} alt="KCG Code logo" className="size-full" />
          </span>

          <h2 id="about-title" className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">
            KCG Code
          </h2>
          <p className="mt-1.5 max-w-xs text-[14px] leading-snug text-pretty text-muted-foreground">
            Your AI coding agent, in your pocket.
          </p>

          <div className="mt-5">
            {version !== null ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 font-mono text-[12.5px] text-muted-foreground"
                title={version === "dev" ? "Running from source (bun dev)" : undefined}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    version === "dev" ? "bg-amber-500" : "bg-emerald-500",
                  )}
                />
                <span className="text-foreground/80">{formatVersion(version)}</span>
              </span>
            ) : failed ? (
              <span className="text-[13px] text-muted-foreground">Version unavailable</span>
            ) : (
              <Skeleton className="h-7 w-20 rounded-full" aria-label="Loading version" />
            )}
          </div>
        </div>
      </section>

      {/* Credits: kartu profil per anggota (bukan baris preferensi). */}
      <section aria-labelledby="about-credits" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5 px-1">
          <h2 id="about-credits" className="text-[15px] font-semibold tracking-tight">
            Credits
          </h2>
          <p className="text-[13px] text-muted-foreground">The people building KCG Code.</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {TEAM.map((m) => (
            <li key={m.username}>
              <a
                href={githubUrl(m.username)}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex h-full items-center gap-3.5 rounded-2xl border bg-card p-4 shadow-xs transition-colors outline-none hover:border-foreground/20 hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-muted/70"
              >
                <img
                  src={`${githubUrl(m.username)}.png?size=112`}
                  alt=""
                  width={44}
                  height={44}
                  loading="lazy"
                  className="size-11 shrink-0 rounded-full bg-muted ring-1 ring-border"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[15px] leading-5 font-medium">@{m.username}</span>
                  <span className="text-[13px] leading-snug text-muted-foreground">{m.role}</span>
                </span>
                <GithubIcon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                <span className="sr-only">(opens GitHub in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <p className="pb-2 text-center text-[12px] text-muted-foreground">
        Built with Bun &amp; OpenCode.
      </p>
    </>
  );
}

/**
 * Mark GitHub (lucide versi ini tidak lagi menyertakan ikon brand).
 * Path resmi dari GitHub Octicons `mark-github`.
 */
function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    // Selalu dekoratif: label tautan sudah ada di teks baris.
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
