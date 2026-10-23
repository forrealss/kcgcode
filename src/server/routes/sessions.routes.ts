/**
 * Tabel rute API Session (Requirement 1, 4): daftar/buat, hapus/resume/ganti
 * model, stop, cari file (`@file`), dan upload lampiran gambar. Dipasang
 * composition root (`app.ts`) — pola kcgcode (`*.routes.ts`).
 */
import type { BunRequest } from "bun";
import type { AgentType } from "../../types";
import type { SimpleResult } from "../result";
import { errorResponse, json, parseModelBody, readObject, respond } from "./helpers";
import type { ApiRouteContext } from "./types";

/** String non-kosong (ter-trim), selain itu null — body `permissionMode` / `effort`. */
function optionalString(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

/** Balasan error SimpleResult yang gagal; `null` bila sukses. */
function failed(res: SimpleResult): Response | null {
  return res.ok ? null : errorResponse(res.error ?? "ERROR");
}

export function sessionsRoutes(ctx: ApiRouteContext) {
  const { sessionManager, attachments, notifyDataChanged } = ctx;

  /** Balasan `{ session, ok: true }` dengan Session terbaru. */
  const currentSession = (id: string) => {
    const cur = sessionManager.getSession(id);
    return json({ session: cur.ok ? cur.data : undefined, ok: true });
  };

  return {
    // ---- Session (Requirement 1, 4) ----
    "/api/sessions": {
      GET: () => json({ sessions: sessionManager.listSessions() }),
      POST: async (req: Request) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const { agentType, projectId, model, effort, agent, permissionMode } = b;
        const res = await sessionManager.createSession({
          agentType: (typeof agentType === "string" ? agentType : "") as AgentType,
          projectId: typeof projectId === "string" ? projectId : "",
          model: parseModelBody(model),
          effort: optionalString(effort),
          agent: optionalString(agent),
          permissionMode: optionalString(permissionMode),
        });
        if (!res.ok) return errorResponse(res.error);
        notifyDataChanged();
        return json({ session: res.session }, 201);
      },
    },

    "/api/sessions/:id": {
      /**
       * Hapus Session permanen — juga menghapus session (dan riwayat
       * pesannya) di server headless opencode: server di-spawn ulang bila
       * mati agar data remote tidak tertinggal. Server tak bisa hidup /
       * menolak hapus -> 5xx, data lokal utuh.
       */
      DELETE: async (req: BunRequest<"/api/sessions/:id">) => {
        const res = await sessionManager.deleteSession(req.params.id);
        if (!res.ok) return errorResponse(res.error ?? "ERROR");
        notifyDataChanged();
        return json({ ok: true });
      },
      /**
       * Resume Session yang stopped/crashed (tombol "Start" di UI).
       * Memakai ocSessionId lama bila masih dikenal server headless;
       * bila tidak, sesi remote baru dibuat & disimpan ke Session.
       */
      POST: async (req: BunRequest<"/api/sessions/:id">) =>
        failed(await sessionManager.resumeSession(req.params.id)) ?? currentSession(req.params.id),
      /**
       * Ganti model, thinking effort, dan/atau agent (mode) pilihan Session —
       * body `{ model: {providerID, modelID} | null, effort: string | null,
       * agent: string | null }`. `null` mengembalikan ke default agent.
       * Berlaku pada prompt berikutnya tanpa perlu restart Session.
       */
      PUT: async (req: BunRequest<"/api/sessions/:id">) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const id = req.params.id;
        if (b.model !== undefined) {
          const model = b.model === null ? null : parseModelBody(b.model);
          const err = failed(sessionManager.setSessionModel(id, model));
          if (err) return err;
        }
        if (b.effort !== undefined) {
          const err = failed(sessionManager.setSessionEffort(id, optionalString(b.effort)));
          if (err) return err;
        }
        if (b.agent !== undefined) {
          const err = failed(sessionManager.setSessionAgent(id, optionalString(b.agent)));
          if (err) return err;
        }
        if (b.permissionMode !== undefined) {
          // Berlaku segera bila agent sedang berjalan (juga di tengah turn).
          const mode = optionalString(b.permissionMode);
          const err = failed(await sessionManager.setSessionPermissionMode(id, mode));
          if (err) return err;
        }
        return currentSession(id);
      },
    },

    // ---- Cari file Project (autocomplete referensi @file di composer) ----
    "/api/sessions/:id/files": {
      GET: async (req: BunRequest<"/api/sessions/:id/files">) => {
        const query = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 200);
        const cur = sessionManager.getSession(req.params.id);
        if (!cur.ok) return errorResponse("SESSION_NOT_FOUND");
        const res = await sessionManager.findFiles(cur.data.projectId, query, cur.data.agentType);
        return respond(res, (files) => ({ files }));
      },
    },

    // ---- Konteks kerja Session (panel kanan: Environment / Task list) ----
    "/api/sessions/:id/context": {
      GET: async (req: BunRequest<"/api/sessions/:id/context">) =>
        respond(await sessionManager.sessionContext(req.params.id), (context) => ({ context })),
    },

    // ---- Lampiran gambar upload dari perangkat ----
    "/api/sessions/:id/uploads": {
      /**
       * Simpan gambar upload ke Attachment_Store Session. Body multipart
       * `file` (nama+mime+bytes). Ukuran & format divalidasi server.
       */
      POST: async (req: BunRequest<"/api/sessions/:id/uploads">) => {
        const cur = sessionManager.getSession(req.params.id);
        if (!cur.ok) return errorResponse("SESSION_NOT_FOUND");
        let form: FormData;
        try {
          form = await req.formData();
        } catch {
          return errorResponse("INVALID_UPLOAD");
        }
        const file = form.get("file");
        if (!(file instanceof File)) return errorResponse("INVALID_UPLOAD");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const res = attachments.save(req.params.id, file.name, file.type, bytes);
        return respond(res, (upload) => ({ upload }), 201);
      },
    },

    // ---- Stop Session (abort turn + status stopped, data tetap ada) ----
    "/api/sessions/:id/stop": {
      POST: (req: BunRequest<"/api/sessions/:id/stop">) =>
        respond(sessionManager.stopSession(req.params.id), () => ({ ok: true })),
    },
  };
}
