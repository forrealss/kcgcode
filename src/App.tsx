/**
 * Shell aplikasi KCG Bridge (task 25.1).
 *
 * Navigasi: Project list -> Session list per Project -> Session view.
 * - `use-theme.ts` (dark mode) dipakai lewat `ThemeToggle` (Req 8.2, 8.6).
 * - Header memuat tombol token otentikasi (opsional, Req 9.2/9.3): token
 *   disimpan di `localStorage` dan dipakai `apiFetch` + `use-websocket`.
 * - `SessionView` di-`key` per `session.id` agar remount saat pindah Session.
 */

import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { ProjectList } from "@/components/project-list";
import { SessionList } from "@/components/session-list";
import { SessionView } from "@/components/session-view";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAuthToken, setAuthToken } from "@/lib/api";
import type { Project, Session } from "@/server/types";
import "./index.css";

import logo from "./logo.svg";

type View =
  | { name: "projects" }
  | { name: "sessions"; project: Project }
  | { name: "session"; project: Project; session: Session };

export function App() {
  const [view, setView] = useState<View>({ name: "projects" });
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState(getAuthToken() ?? "");

  const saveToken = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthToken(token);
    setTokenOpen(false);
  };

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <img src={logo} alt="KCG Bridge" className="size-7" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold leading-tight">KCG Bridge</span>
            <span className="truncate text-[11px] leading-tight text-muted-foreground">
              Kontrol CLI_Agent dari HP
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setTokenOpen((o) => !o)}
            aria-label="Pengaturan token otentikasi"
            title="Token otentikasi"
            data-active={tokenOpen}
          >
            <KeyRoundIcon data-icon="inline-start" />
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {/* Input token (opsional, Requirement 9.2/9.3) */}
      {tokenOpen && (
        <form
          onSubmit={saveToken}
          className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-2"
        >
          <Input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Token otentikasi (kosongkan untuk menghapus)"
            aria-label="Token otentikasi"
            type="password"
            autoComplete="off"
            className="h-8"
          />
          <Button type="submit" size="sm">
            Simpan
          </Button>
        </form>
      )}

      {/* Konten */}
      {view.name === "session" ? (
        <main className="min-h-0 flex-1">
          <SessionView
            key={view.session.id}
            session={view.session}
            onBack={() => setView({ name: "sessions", project: view.project })}
          />
        </main>
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl p-4 pb-12">
            {view.name === "projects" && (
              <ProjectList onOpenProject={(project) => setView({ name: "sessions", project })} />
            )}
            {view.name === "sessions" && (
              <SessionList
                key={view.project.id}
                project={view.project}
                onOpenSession={(session) =>
                  setView({ name: "session", project: view.project, session })
                }
                onBack={() => setView({ name: "projects" })}
              />
            )}
          </div>
        </main>
      )}
    </div>
  );
}

export default App;
