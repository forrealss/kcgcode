/**
 * Tabel rute API Session (Requirement 1, 4): daftar/buat, hapus/resume/ganti
 * model, stop, cari file (`@file`), dan upload lampiran gambar. Dipasang
 * composition root (`app.ts`) — pola kcgcode (`*.routes.ts`).
 */
import type { BunRequest } from "bun";
import type { AgentType } from "../../types";
import { errorStatus, json, parseModelBody, readJson, serverError } from "./helpers";
import type { ApiRouteContext } from "./types";

export function sessionsRoutes(ctx: ApiRouteContext) {
  const { sessionManager, attachments, guard } = ctx;
  return {
    // ---- Session (Requirement 1, 4) ----
    "/api/sessions": {
      GET: guard(() => {
        try {
          return json({ sessions: sessionManager.listSessions() });
        } catch (e) {
          return serverError(e);
        }
      }),
      POST: guard(async (req) => {
        try {
          const body = await readJson(req);
          if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
          const { agentType, projectId, model, agent } = body.data as {
            agentType?: unknown;
            projectId?: unknown;
            model?: unknown;
            agent?: unknown;
          };
          const res = await sessionManager.createSession({
            agentType: (typeof agentType === "string" ? agentType : "") as AgentType,
            projectId: typeof projectId === "string" ? projectId : "",
            model: parseModelBody(model),
            agent: typeof agent === "string" && agent.trim() !== "" ? agent.trim() : null,
          });
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ session: res.session }, 201);
        } catch (e) {
          return serverError(e);
        }
      }),
    },

    "/api/sessions/:id": {
      /**
       * Hapus Session permanen — juga menghapus session (dan riwayat
       * pesannya) di server headless opencode: server di-spawn ulang bila
       * mati agar data remote tidak tertinggal. Server tak bisa hidup /
       * menolak hapus -> 5xx, data lokal utuh.
       */
      DELETE: guard(async (req: BunRequest<"/api/sessions/:id">) => {
        try {
          const res = await sessionManager.deleteSession(req.params.id);
          if (!res.ok) {
            return json({ error: res.error ?? "ERROR" }, errorStatus(res.error ?? ""));
          }
          return json({ ok: true });
        } catch (e) {
          return serverError(e);
        }
      }),
      /**
       * Resume Session yang stopped/crashed (tombol "Start" di UI).
       * Memakai ocSessionId lama bila masih dikenal server headless;
       * bila tidak, sesi remote baru dibuat & disimpan ke Session.
       */
      POST: guard(async (req: BunRequest<"/api/sessions/:id">) => {
        try {
          const res = await sessionManager.resumeSession(req.params.id);
          if (!res.ok) {
            return json({ error: res.error ?? "ERROR" }, errorStatus(res.error ?? ""));
          }
          const cur = sessionManager.getSession(req.params.id);
          return json({ session: cur.ok ? cur.data : undefined, ok: true });
        } catch (e) {
          return serverError(e);
        }
      }),
      /**
       * Ganti model dan/atau agent (mode) pilihan Session — body
       * `{ model: {providerID, modelID} | null, agent: string | null }`.
       * `null` mengembalikan ke default opencode. Berlaku pada prompt
       * berikutnya tanpa perlu restart Session.
       */
      PUT: guard(async (req: BunRequest<"/api/sessions/:id">) => {
        try {
          const body = await readJson(req);
          if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
          const { model: rawModel, agent: rawAgent } = body.data as {
            model?: unknown;
            agent?: unknown;
          };
          if (rawModel !== undefined) {
            const model = rawModel === null ? null : parseModelBody(rawModel);
            const res = sessionManager.setSessionModel(req.params.id, model);
            if (!res.ok) {
              return json({ error: res.error ?? "ERROR" }, errorStatus(res.error ?? ""));
            }
          }
          if (rawAgent !== undefined) {
            const agent =
              typeof rawAgent === "string" && rawAgent.trim() !== "" ? rawAgent.trim() : null;
            const res = sessionManager.setSessionAgent(req.params.id, agent);
            if (!res.ok) {
              return json({ error: res.error ?? "ERROR" }, errorStatus(res.error ?? ""));
            }
          }
          const cur = sessionManager.getSession(req.params.id);
          return json({ session: cur.ok ? cur.data : undefined, ok: true });
        } catch (e) {
          return serverError(e);
        }
      }),
    },

    // ---- Cari file Project (autocomplete referensi @file di composer) ----
    "/api/sessions/:id/files": {
      GET: guard(async (req: BunRequest<"/api/sessions/:id/files">) => {
        try {
          const url = new URL(req.url);
          const query = (url.searchParams.get("q") ?? "").slice(0, 200);
          const cur = sessionManager.getSession(req.params.id);
          if (!cur.ok)
            return json({ error: "SESSION_NOT_FOUND" }, errorStatus("SESSION_NOT_FOUND"));
          const res = await sessionManager.findFiles(cur.data.projectId, query);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ files: res.data });
        } catch (e) {
          return serverError(e);
        }
      }),
    },

    // ---- Lampiran gambar upload dari perangkat ----
    "/api/sessions/:id/uploads": {
      /**
       * Simpan gambar upload ke Attachment_Store Session. Body multipart
       * `file` (nama+mime+bytes). Ukuran & format divalidasi server.
       */
      POST: guard(async (req: BunRequest<"/api/sessions/:id/uploads">) => {
        try {
          const cur = sessionManager.getSession(req.params.id);
          if (!cur.ok) return json({ error: "SESSION_NOT_FOUND" }, 404);
          let form: FormData;
          try {
            form = await req.formData();
          } catch {
            return json({ error: "INVALID_UPLOAD" }, 400);
          }
          const file = form.get("file");
          if (!(file instanceof File)) {
            return json({ error: "INVALID_UPLOAD" }, 400);
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          const res = attachments.save(req.params.id, file.name, file.type, bytes);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ upload: res.data }, 201);
        } catch (e) {
          return serverError(e);
        }
      }),
    },

    // ---- Stop Session (abort turn + status stopped, data tetap ada) ----
    "/api/sessions/:id/stop": {
      POST: guard((req: BunRequest<"/api/sessions/:id/stop">) => {
        try {
          const res = sessionManager.stopSession(req.params.id);
          if (!res.ok) {
            return json({ error: res.error ?? "ERROR" }, errorStatus(res.error ?? ""));
          }
          return json({ ok: true });
        } catch (e) {
          return serverError(e);
        }
      }),
    },
  };
}
