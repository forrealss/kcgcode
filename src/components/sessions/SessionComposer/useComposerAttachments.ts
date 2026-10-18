/**
 * Antrean lampiran composer: validasi & penambahan file (file picker, paste,
 * drag & drop), upload seketika (agar lampiran langsung punya id dan ikut
 * tersinkron ke draf Session / overlay Preview), penghapusan (object URL
 * thumbnail ikut dilepas), serta
 * animasi plate drop (`DropPlate`) dari kartu overlay "Add anything" ke
 * deretan lampiran.
 *
 * State antrean (`pendingImages`) tetap milik composer dan dioper ke sini:
 * `useStackedLayout` (butuh jumlah lampiran) harus dipanggil SEBELUM hook
 * ini, agar layout effect-nya — penyesuaian tinggi textarea — berjalan
 * sebelum tujuan plate & kotak composer diukur.
 */
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PendingAttachment } from "@/components/sessions/PendingAttachments";
import { apiErrorMessage, apiUploadFile, errorText } from "@/lib/api";
import { isPreviewableImage, MAX_ATTACHMENT_BYTES } from "@/lib/attachments";

/**
 * Animasi plate drop yang sedang berjalan: item-nya sudah ada di
 * `pendingImages` (tak terlihat, jadi tujuan animasi) sampai plate
 * mendarat. `targets` diisi setelah layout diukur.
 */
export interface DropPlateState {
  from: DOMRect;
  keys: string[];
  targets: { item: PendingAttachment; rect: DOMRect }[] | null;
  /** Kotak composer: plate menyusut menjadi kotak ini lalu larut ke dalamnya. */
  box: DOMRect | null;
}

export interface UseComposerAttachmentsOptions {
  /** Session tujuan upload lampiran. */
  sessionId: string;
  /** Antrean lampiran (state milik composer). */
  pendingImages: PendingAttachment[];
  setPendingImages: Dispatch<SetStateAction<PendingAttachment[]>>;
  /** Set error banner global (file kosong / terlalu besar). */
  reportError: (message: string | null) => void;
  /** Kotak composer (tujuan akhir latar plate). Ref milik composer. */
  boxRef: RefObject<HTMLElement | null>;
}

export interface ComposerAttachments {
  /** Plate drop yang sedang berjalan; null = tidak ada animasi. */
  plate: DropPlateState | null;
  /** Lampirkan file; `from` = rect asal animasi (kartu overlay). */
  addFiles: (files: Iterable<File>, from?: DOMRect | null) => void;
  /** Hapus satu lampiran (object URL thumbnail ikut dilepas). */
  removeAttachment: (key: string) => void;
  /**
   * Tunggu semua upload yang sedang berjalan selesai (sebelum kirim);
   * hasilnya peta key lampiran -> id yang baru didapat (state React belum
   * tentu sudah dirender ulang saat itu).
   */
  waitForUploads: () => Promise<Map<string, string>>;
  /** Daftarkan elemen tiap lampiran (tujuan animasi plate). */
  registerAttachmentEl: (key: string, el: HTMLElement | null) => void;
  /** Plate selesai mendarat. */
  endPlate: () => void;
}

export function useComposerAttachments({
  sessionId,
  pendingImages,
  setPendingImages,
  reportError,
  boxRef,
}: UseComposerAttachmentsOptions): ComposerAttachments {
  const [plate, setPlate] = useState<DropPlateState | null>(null);
  /** Elemen tiap lampiran (untuk mengukur tujuan animasi plate). */
  const attachmentEls = useRef(new Map<string, HTMLElement>());
  /** Upload yang sedang berjalan per key lampiran (hasil: id, atau null bila gagal). */
  const uploads = useRef(new Map<string, Promise<string | null>>());

  /** Unggah satu lampiran; gagal -> pesan error & lampiran dibuang. */
  const upload = useCallback(
    (item: PendingAttachment & { file: File }) => {
      const done = apiUploadFile(`/api/sessions/${sessionId}/uploads`, item.file)
        .then((up): string => {
          setPendingImages((prev) =>
            prev.map((p) => (p.key === item.key ? { ...p, id: up.id, uploading: false } : p)),
          );
          return up.id;
        })
        .catch((e: unknown): null => {
          reportError(errorText(e, apiErrorMessage("ERROR")));
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          setPendingImages((prev) => prev.filter((p) => p.key !== item.key));
          return null;
        })
        .finally(() => uploads.current.delete(item.key));
      uploads.current.set(item.key, done);
    },
    [sessionId, setPendingImages, reportError],
  );

  const waitForUploads = useCallback(async () => {
    const entries = [...uploads.current.entries()];
    const ids = new Map<string, string>();
    for (const [key, done] of entries) {
      const id = await done;
      if (id) ids.set(key, id);
    }
    return ids;
  }, []);

  /**
   * Terima file dari file picker / paste / drag & drop, validasi, lalu
   * simpan ke antrean lampiran. File kosong / folder / terlalu besar ditolak
   * dengan pesan. `from` (rect kartu overlay) -> animasi plate.
   */
  const addFiles = useCallback(
    (files: Iterable<File>, from?: DOMRect | null) => {
      const picked: Array<PendingAttachment & { file: File }> = [];
      for (const file of files) {
        // Folder yang di-drop muncul sebagai File 0 byte tanpa tipe.
        if (file.size === 0) {
          reportError(`"${file.name}" is empty or is a folder.`);
          continue;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          reportError(`"${file.name}" exceeds the 20 MiB limit.`);
          continue;
        }
        picked.push({
          key: crypto.randomUUID(),
          name: file.name,
          mime: file.type,
          size: file.size,
          file,
          previewUrl: isPreviewableImage(file.type) ? URL.createObjectURL(file) : null,
          uploading: true,
        });
      }
      if (picked.length === 0) return;
      setPendingImages((prev) => [...prev, ...picked]);
      for (const item of picked) upload(item);
      if (from) setPlate({ from, keys: picked.map((p) => p.key), targets: null, box: null });
    },
    [reportError, setPendingImages, upload],
  );

  // Item plate sudah dirender (tak terlihat) -> ukur posisi akhirnya. Deretan
  // lampiran di-scroll ke item baru dulu agar tujuan animasi terlihat.
  useLayoutEffect(() => {
    if (!plate || plate.targets) return;
    const firstEl = attachmentEls.current.get(plate.keys[0] ?? "");
    firstEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const targets = plate.keys.flatMap((key) => {
      const item = pendingImages.find((p) => p.key === key);
      const el = attachmentEls.current.get(key);
      return item && el ? [{ item, rect: el.getBoundingClientRect() }] : [];
    });
    if (targets.length === 0) setPlate(null);
    else setPlate({ ...plate, targets, box: boxRef.current?.getBoundingClientRect() ?? null });
  }, [plate, pendingImages, boxRef]);

  const registerAttachmentEl = useCallback((key: string, el: HTMLElement | null) => {
    if (el) attachmentEls.current.set(key, el);
    else attachmentEls.current.delete(key);
  }, []);
  const endPlate = useCallback(() => setPlate(null), []);

  const removeAttachment = useCallback(
    (key: string) => {
      setPendingImages((prev) => {
        const target = prev.find((p) => p.key === key);
        // Hanya object URL lokal yang dilepas (bukan URL lampiran server).
        if (target?.file && target.previewUrl) URL.revokeObjectURL(target.previewUrl);
        return prev.filter((p) => p.key !== key);
      });
    },
    [setPendingImages],
  );

  return { plate, addFiles, removeAttachment, waitForUploads, registerAttachmentEl, endPlate };
}
