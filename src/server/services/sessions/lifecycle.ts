/**
 * Lifecycle Session: buat, stop, interrupt, resume, hapus, dan lepas seluruh
 * Session milik Project. Session berstatus `running` hanya setelah berhasil
 * dibuat di agent; penghapusan remote wajib sukses sebelum data lokal dihapus.
 */
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import type { Session, SessionModel } from "../../../types";
import type { SimpleResult } from "../../result";
import { isPlaceholderTitle } from "../session-events";
import type { SessionRuntime } from "./runtime";
import { type CreateSessionRequest, type CreateSessionResult, isEffortId } from "./types";

function isDirectory(dir: string): boolean {
  try {
    return existsSync(dir) && statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function createSessionLifecycle(rt: SessionRuntime) {
  const { store, attachments, now, clients, turns, agentSessions, onDeleted } = rt;

  async function createSession(req: CreateSessionRequest): Promise<CreateSessionResult> {
    // (1) tipe CLI_Agent didukung (Requirement 1.3)
    if (!clients.isEnabled(req.agentType)) return { ok: false, error: "UNSUPPORTED_AGENT_TYPE" };
    // (2) Project ada di Session_Store (Requirement 10.10)
    const projectRes = store.getProjectById(req.projectId);
    if (!projectRes.ok) return { ok: false, error: "PROJECT_NOT_FOUND" };
    const project = projectRes.data;
    // (3) direktori kerja Project masih ada di filesystem (Requirement 10.11)
    if (!isDirectory(project.path)) return { ok: false, error: "PROJECT_DIR_NOT_FOUND" };

    // (4) pastikan client agent untuk Project siap
    const clientRes = await clients.ensure(project.id, project.path, req.agentType);
    if (!clientRes.ok) return { ok: false, error: clientRes.error };
    const client = clientRes.data;

    // (5) validasi model pilihan terhadap daftar model agent (Req: pilih
    //     model). `null` = pakai default agent. Daftar model gagal diambil ->
    //     ditolak agar Session tidak lahir dengan model mati.
    const model: SessionModel | null = req.model ?? null;
    if (model) {
      const models = await client.model.list();
      if (!models.ok) return { ok: false, error: models.error };
      const known = models.data.some(
        (m) => m.providerID === model.providerID && m.modelID === model.modelID,
      );
      if (!known) return { ok: false, error: "MODEL_NOT_FOUND" };
    }

    const effort = req.effort ?? null;
    if (effort !== null && !isEffortId(effort)) return { ok: false, error: "INVALID_EFFORT" };

    // (5b) permission mode harus salah satu yang ditawarkan agent.
    const permissionMode = req.permissionMode ?? null;
    if (
      permissionMode !== null &&
      !client.capabilities.permissionModes.some((m) => m.id === permissionMode)
    ) {
      return { ok: false, error: "INVALID_PERMISSION_MODE" };
    }

    // (6) buat Session di agent — TANPA judul, agar agent meng-generate judul
    //     dari prompt pertama (lihat lib/session-title.ts).
    const created = await client.session.create();
    if (!created.ok) return { ok: false, error: created.error };

    const sessionId = randomUUID();
    const createdAt = now();
    // Judul placeholder tidak disimpan. Judul datang dari `session.renamed`;
    // sementara itu `sendFreeTextInput` memberi judul turunan prompt pertama.
    const remoteTitle =
      typeof created.data.title === "string" && !isPlaceholderTitle(created.data.title)
        ? created.data.title
        : null;
    const session: Session = {
      id: sessionId,
      projectId: project.id,
      agentType: req.agentType,
      cwd: project.path,
      status: "running",
      ocSessionId: created.data.id,
      title: remoteTitle,
      model,
      effort,
      agent: req.agent ?? null,
      permissionMode,
      createdAt,
      updatedAt: createdAt,
    };
    const ins = store.insertSession(session);
    if (!ins.ok) {
      // Hapus session remote agar tidak jadi yatim bila persistensi gagal.
      void client.session.remove(created.data.id);
      return ins;
    }
    agentSessions.map(created.data.id, sessionId);
    return { ok: true, session };
  }

  function stopSession(sessionId: string): SimpleResult {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    if (cur.data.status !== "running") return { ok: false, error: "SESSION_NOT_RUNNING" };
    // Abort turn berjalan (best-effort, tidak menunggu).
    rt.interruptRemote(cur.data);
    // Simpan parts yang sudah terkumpul sebelum Session ditutup.
    turns.finish(sessionId);
    // Lepas induk + seluruh child sub-agent milik Session ini.
    agentSessions.unmap(sessionId);
    rt.updateStatus(sessionId, "stopped", now());
    return { ok: true };
  }

  /**
   * Hentikan balasan model yang sedang berlangsung:
   * - Turn remote di-interrupt (best-effort, tidak menunggu).
   * - Parts yang sudah ter-stream DIBUANG (tidak disimpan) — user membatalkan
   *   balasan, sehingga respon parsial tidak boleh muncul di riwayat/UI.
   * - Session TETAP `running` dan pemetaan event dipertahankan — user bisa
   *   langsung mengirim pesan baru tanpa Start ulang.
   * Idempoten: tanpa turn aktif tidak ada yang berubah (tetap `ok`).
   */
  function interruptSession(sessionId: string): SimpleResult {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    if (cur.data.status === "running") rt.interruptRemote(cur.data);
    // Buang turn parsial (tidak disimpan) + broadcast turn tidak aktif.
    turns.discard(sessionId);
    return { ok: true };
  }

  /**
   * Menghidupkan kembali Session yang `stopped`/`crashed` dengan riwayat
   * percakapan utuh:
   *
   * 1. Client agent Project di-ensure (koneksi/proses dibuat ulang bila
   *    perlu) — storage Session agent bertahan di disk, sehingga id Session
   *    lama biasanya masih dikenal.
   * 2. id Session agent diverifikasi (`session.get`). Bila masih ada, dipakai
   *    lagi (riwayat agent tetap nyambung). Bila tidak, dibuat Session agent
   *    baru dan `oc_session_id` di DB diperbarui — pesan lama di
   *    Session_Store tidak tersentuh.
   * 3. Pemetaan event diaktifkan kembali lalu status -> `running`.
   */
  async function resumeSession(sessionId: string): Promise<SimpleResult> {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    if (cur.data.status === "running") return { ok: false, error: "SESSION_ALREADY_RUNNING" };
    const project = store.getProjectById(cur.data.projectId);
    if (!project.ok) return { ok: false, error: "PROJECT_NOT_FOUND" };

    // (1) Pastikan client agent Project siap.
    const clientRes = await clients.ensure(project.data.id, project.data.path, cur.data.agentType);
    if (!clientRes.ok) return { ok: false, error: clientRes.error };
    const client = clientRes.data;

    // (2) Verifikasi id Session agent lama; bila tidak dikenal -> Session baru.
    let ocSessionId = cur.data.ocSessionId;
    if (ocSessionId) {
      const remote = await client.session.get(ocSessionId);
      if (remote.ok) {
        agentSessions.map(ocSessionId, sessionId);
      } else {
        ocSessionId = null;
      }
    }
    if (!ocSessionId) {
      // Session agent baru (yang lama hilang). Tanpa judul: bila Session belum
      // punya judul, agent akan meng-generate-nya dari prompt berikutnya.
      const created = await client.session.create();
      if (!created.ok) return { ok: false, error: created.error };
      ocSessionId = created.data.id;
      agentSessions.map(ocSessionId, sessionId);
      const upd = store.updateSessionOcId(sessionId, ocSessionId);
      if (!upd.ok) return { ok: false, error: upd.error };
    }

    // (3) Status kembali running.
    rt.updateStatus(sessionId, "running", now());
    return { ok: true };
  }

  /**
   * Hapus Session permanen:
   *
   * 1. Turn yang sedang stream difinalisasi & pemetaan event dilepas.
   * 2. Pastikan client agent Project siap lalu `session.remove`: data Session
   *    (termasuk seluruh pesan) ikut dihapus di sisi agent. Penghapusan
   *    remote bersifat wajib: bila agent tidak bisa dihubungi atau menolak
   *    hapus, error diteruskan dan data lokal TIDAK dihapus — supaya tidak
   *    ada Session agent yang jadi yatim (bisa dicoba lagi kemudian).
   * 3. Baris Session + seluruh baris anaknya dihapus dari Session_Store.
   */
  async function deleteSession(sessionId: string): Promise<SimpleResult> {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };

    turns.finish(sessionId);
    // Bila masih running, hentikan turn remote agar model berhenti dieksekusi.
    if (cur.data.status === "running") rt.interruptRemote(cur.data);
    agentSessions.unmap(sessionId);

    // (2) Hapus di agent — wajib.
    const ocSessionId = cur.data.ocSessionId;
    if (ocSessionId) {
      let client = rt.clientFor(cur.data.agentType, cur.data.projectId);
      if (!client) {
        const res = await rt.projectClient(cur.data.projectId, cur.data.agentType);
        if (!res.ok) return { ok: false, error: res.error };
        client = res.data;
      }
      const remote = await client.session.remove(ocSessionId);
      if (!remote.ok) return { ok: false, error: remote.error };
    }

    // (3) Hapus lokal (transaksional: messages, prompts, history, session).
    const res = store.deleteSession(sessionId);
    if (res.ok) {
      // Lampiran gambar milik Session ikut dibersihkan (best effort).
      attachments?.removeSession(sessionId);
      onDeleted?.(sessionId);
    }
    return res;
  }

  /**
   * Lepaskan seluruh sumber daya milik satu Project — dipakai rute
   * `DELETE /api/projects/:id` sebelum baris Project dihapus:
   *
   * 1. Setiap Session milik Project dihapus lewat `deleteSession` sehingga
   *    Session agent, lampiran gambar, dan baris anaknya ikut bersih.
   *    Kegagalan menghentikan proses (error diteruskan) supaya tidak ada
   *    Session agent yatim — user bisa mencoba lagi.
   * 2. Client agent Project dilepas.
   */
  async function releaseProject(projectId: string): Promise<SimpleResult> {
    if (!store.getProjectById(projectId).ok) return { ok: false, error: "PROJECT_NOT_FOUND" };
    for (const session of store.listProjectSessions(projectId)) {
      const res = await deleteSession(session.id);
      if (!res.ok) return res;
    }
    await clients.release(projectId);
    return { ok: true };
  }

  return {
    createSession,
    stopSession,
    interruptSession,
    resumeSession,
    deleteSession,
    releaseProject,
  };
}
