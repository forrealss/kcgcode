/**
 * Sinkronisasi draf composer <-> Session (perangkat lain & overlay Preview).
 * Server menyimpan satu draf per Session (`src/types/draft.ts`); composer
 * mengirim perubahannya lewat WS dan menerapkan perubahan pihak lain.
 *
 * - Teks dikirim setelah jeda mengetik singkat; lampiran/elemen & draf
 *   kosong (pesan terkirim) dikirim seketika. Lampiran baru ikut setelah
 *   upload-nya selesai (perlu id).
 * - Siaran balik milik sendiri diabaikan lewat `origin` (`DRAFT_CLIENT_ID`).
 * - Snapshot server (`origin: "server"`, saat attach / reconnect) tidak
 *   menimpa perubahan lokal yang belum tersinkron — draf lokal yang dikirim.
 * - Composer dipasang ulang (ganti varian layout, prompt pertanyaan selesai):
 *   draf terakhir yang diketahui dipulihkan.
 */
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef } from "react";
import type { PendingAttachment } from "@/components/sessions/PendingAttachments";
import { attachmentUrl } from "@/lib/api";
import { isPreviewableImage } from "@/lib/attachments";
import {
  DRAFT_CLIENT_ID,
  type DraftUpdate,
  latestDraft,
  onDraft,
  rememberDraft,
} from "@/lib/draft-events";
import {
  type ComposerDraft,
  type DraftElement,
  draftSignature,
  EMPTY_DRAFT,
  isEmptyDraft,
} from "@/types";
import type { ClientMessage } from "@/ws-protocol";

const TEXT_DEBOUNCE_MS = 300;

export interface UseDraftSyncOptions {
  sessionId: string;
  send: (msg: ClientMessage) => boolean;
  text: string;
  setText: (text: string) => void;
  attachments: PendingAttachment[];
  setAttachments: Dispatch<SetStateAction<PendingAttachment[]>>;
  elements: DraftElement[];
  setElements: (elements: DraftElement[]) => void;
}

export function useDraftSync({
  sessionId,
  send,
  text,
  setText,
  attachments,
  setAttachments,
  elements,
  setElements,
}: UseDraftSyncOptions): void {
  /** Draf terakhir yang diketahui sama di server (dikirim atau diterima). */
  const synced = useRef<ComposerDraft>(EMPTY_DRAFT);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const local = useMemo<ComposerDraft>(
    () => ({
      text,
      // Lampiran yang masih diunggah belum punya id — ikut setelah selesai.
      attachments: attachments.flatMap((a) =>
        a.id ? [{ id: a.id, name: a.name, mime: a.mime, size: a.size }] : [],
      ),
      elements,
    }),
    [text, attachments, elements],
  );
  const localRef = useRef(local);
  localRef.current = local;

  const push = useCallback(
    (draft: ComposerDraft) => {
      clearTimeout(timer.current);
      const prev = synced.current;
      synced.current = draft;
      if (send({ type: "draft", sessionId, draft, origin: DRAFT_CLIENT_ID })) {
        rememberDraft(sessionId, { draft, origin: DRAFT_CLIENT_ID });
      } else {
        // Tidak terkirim (WS putus): tetap "belum tersinkron" -> snapshot
        // server saat reconnect memicu pengiriman ulang.
        synced.current = prev;
      }
    },
    [send, sessionId],
  );

  // Lokal -> server.
  useEffect(() => {
    const cur = draftSignature(synced.current);
    if (draftSignature(local) === cur) {
      clearTimeout(timer.current);
      return;
    }
    const textOnly = draftSignature({ ...local, text: synced.current.text }) === cur;
    clearTimeout(timer.current);
    if (textOnly && !isEmptyDraft(local)) {
      timer.current = setTimeout(() => push(localRef.current), TEXT_DEBOUNCE_MS);
    } else {
      push(local);
    }
  }, [local, push]);

  // Composer dilepas saat teks belum terkirim (jeda mengetik): kirim sekarang.
  useEffect(
    () => () => {
      if (draftSignature(localRef.current) !== draftSignature(synced.current)) {
        push(localRef.current);
      }
    },
    [push],
  );

  const apply = useCallback(
    (u: DraftUpdate, restoring = false) => {
      if (!restoring && u.origin === DRAFT_CLIENT_ID) return;
      const unsynced = draftSignature(localRef.current) !== draftSignature(synced.current);
      if (!restoring && u.origin === "server" && unsynced) {
        push(localRef.current);
        return;
      }
      clearTimeout(timer.current);
      synced.current = u.draft;
      setText(u.draft.text);
      setElements(u.draft.elements);
      setAttachments((prev) => {
        const byId = new Map(prev.flatMap((p) => (p.id ? [[p.id, p] as const] : [])));
        const remote = new Set(u.draft.attachments.map((a) => a.id));
        for (const p of prev) {
          if (p.id && !remote.has(p.id) && p.file && p.previewUrl) {
            URL.revokeObjectURL(p.previewUrl);
          }
        }
        const next = u.draft.attachments.map(
          (a): PendingAttachment =>
            byId.get(a.id) ?? {
              key: a.id,
              name: a.name,
              mime: a.mime,
              size: a.size,
              id: a.id,
              previewUrl: isPreviewableImage(a.mime) ? attachmentUrl(sessionId, a.id) : null,
            },
        );
        // Upload lokal yang masih berjalan tetap dipertahankan.
        return [...next, ...prev.filter((p) => !p.id)];
      });
    },
    [push, sessionId, setText, setElements, setAttachments],
  );

  useEffect(() => {
    const last = latestDraft(sessionId);
    if (last) apply(last, true);
    return onDraft(sessionId, (u) => apply(u));
  }, [sessionId, apply]);
}
