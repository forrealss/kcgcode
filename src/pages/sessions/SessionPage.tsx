/**
 * Halaman Session view (`/projects/:projectId/sessions/:sessionId`).
 *
 * - `Session` di-resolve dari id di URL via `GET /api/sessions` (Requirement
 *   1.5) sehingga halaman dapat di-refresh / diakses langsung (direct link)
 *   tanpa state dari halaman sebelumnya.
 * - Session tidak ditemukan (sudah dihapus / id salah) -> pesan error dengan
 *   aksi kembali ke daftar Session Project terkait.
 * - Render memakai `SessionView` yang sudah ada; dibungkus container yang
 *   sama dengan halaman lain.
 */

import { useCallback, useEffect, useState } from "react";
import { SessionView } from "@/components/sessions/SessionView";
import { useRouter } from "@/hooks/useRouter";
import { ApiError, apiErrorMessage, apiFetch } from "@/lib/api";
import { projectPath } from "@/lib/routes";
import type { Session } from "@/types";

export interface SessionPageProps {
  projectId: string;
  sessionId: string;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; code: string }
  | { phase: "ready"; session: Session };

export function SessionPage({ projectId, sessionId }: SessionPageProps) {
  const { navigate } = useRouter();
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const res = await apiFetch("/api/sessions");
      const body = (await res.json()) as { sessions: Session[] };
      const session = body.sessions.find((s) => s.id === sessionId && s.projectId === projectId);
      if (session === undefined) {
        setState({ phase: "error", code: "SESSION_NOT_FOUND" });
      } else {
        setState({ phase: "ready", session });
      }
    } catch (e) {
      setState({
        phase: "error",
        code: e instanceof ApiError ? e.code : "INTERNAL_ERROR",
      });
    }
  }, [projectId, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        Memuat…
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">{apiErrorMessage(state.code)}</p>
        <a
          href={projectPath(projectId)}
          onClick={(e) => {
            e.preventDefault();
            navigate(projectPath(projectId));
          }}
          className="text-sm font-medium underline underline-offset-4"
        >
          Kembali ke daftar Session
        </a>
      </div>
    );
  }

  return (
    <main className="min-h-0 flex-1">
      <SessionView
        key={state.session.id}
        session={state.session}
        onBack={() => navigate(projectPath(projectId))}
        // Session sudah tidak ada — kembali ke daftar Session Project.
        onDeleted={() => navigate(projectPath(projectId))}
      />
    </main>
  );
}
