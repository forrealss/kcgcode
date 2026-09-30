/**
 * Settings -> Profile: akun KCG Code yang tersambung ke mesin ini (akun yang
 * dipakai Remote access). Data dari `GET /api/tunnel` — hanya email,
 * username, dan alamat; token & secret tidak pernah dikirim ke browser.
 */
import { GlobeIcon, UserRoundIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ActionRow, PrefsGroup, RowBadge } from "@/components/settings/prefs";
import { Spinner } from "@/components/ui/spinner";
import { useRouter } from "@/hooks/useRouter";
import { apiFetch } from "@/lib/api";
import { settingsPath } from "@/lib/routes";
import type { TunnelStatus } from "@/server/services/tunnel";

type AccountState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; configured: boolean; account: TunnelStatus["account"] };

export function AccountGroup() {
  const { navigate } = useRouter();
  const [state, setState] = useState<AccountState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch("/api/tunnel");
        const { tunnel } = (await res.json()) as { tunnel: TunnelStatus };
        if (!cancelled) {
          setState({ phase: "ready", configured: tunnel.configured, account: tunnel.account });
        }
      } catch {
        if (!cancelled) setState({ phase: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const title = "Account";

  if (state.phase === "loading") {
    return (
      <PrefsGroup title={title}>
        <li className="flex min-h-16 items-center justify-center" role="status">
          <Spinner className="size-5 text-muted-foreground" />
          <span className="sr-only">Loading account…</span>
        </li>
      </PrefsGroup>
    );
  }

  if (state.phase === "error") {
    return (
      <PrefsGroup title={title}>
        <ActionRow title="Couldn't load account" subtitle="Reload the page to try again." />
      </PrefsGroup>
    );
  }

  const { account, configured } = state;
  const goRemote = () => navigate(settingsPath("remote"));

  if (!account) {
    return (
      <PrefsGroup title={title}>
        <ActionRow
          prefix={<AccountIcon />}
          title="No account linked"
          subtitle={
            configured
              ? "Sign in with Google in Remote access to use KCG Code from anywhere"
              : "Remote access isn't available in this version"
          }
          onActivate={configured ? goRemote : undefined}
        />
      </PrefsGroup>
    );
  }

  return (
    <PrefsGroup title={title}>
      {/* Email jadi baris utama (yang dikenali pengguna); username sekunder. */}
      <li className="flex items-center gap-3 px-4 py-3">
        <AccountIcon />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[15px] leading-5" title={account.email}>
            {account.email}
          </span>
          <span className="truncate text-[13px] text-muted-foreground">
            Signed in with Google · @{account.username}
          </span>
        </div>
        <RowBadge tone="success">Linked</RowBadge>
      </li>
      <ActionRow
        prefix={
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <GlobeIcon className="size-5" aria-hidden />
          </span>
        }
        title="Remote access"
        subtitle={
          <span className="block truncate" title={account.url}>
            {account.url.replace(/^https?:\/\//, "")}
          </span>
        }
        onActivate={goRemote}
      />
    </PrefsGroup>
  );
}

function AccountIcon() {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <UserRoundIcon className="size-5" aria-hidden />
    </span>
  );
}
