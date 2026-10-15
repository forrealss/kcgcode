/**
 * Antrean lampiran composer: validasi & penambahan file (file picker, paste,
 * drag & drop), penghapusan (object URL thumbnail ikut dilepas), serta
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
  /** Daftarkan elemen tiap lampiran (tujuan animasi plate). */
  registerAttachmentEl: (key: string, el: HTMLElement | null) => void;
  /** Plate selesai mendarat. */
  endPlate: () => void;
}

export function useComposerAttachments({
  pendingImages,
  setPendingImages,
  reportError,
  boxRef,
}: UseComposerAttachmentsOptions): ComposerAttachments {
  const [plate, setPlate] = useState<DropPlateState | null>(null);
  /** Elemen tiap lampiran (untuk mengukur tujuan animasi plate). */
  const attachmentEls = useRef(new Map<string, HTMLElement>());

  /**
   * Terima file dari file picker / paste / drag & drop, validasi, lalu
   * simpan ke antrean lampiran. File kosong / folder / terlalu besar ditolak
   * dengan pesan. `from` (rect kartu overlay) -> animasi plate.
   */
  const addFiles = useCallback(
    (files: Iterable<File>, from?: DOMRect | null) => {
      const picked: PendingAttachment[] = [];
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
          file,
          previewUrl: isPreviewableImage(file.type) ? URL.createObjectURL(file) : null,
        });
      }
      if (picked.length === 0) return;
      setPendingImages((prev) => [...prev, ...picked]);
      if (from) setPlate({ from, keys: picked.map((p) => p.key), targets: null, box: null });
    },
    [reportError, setPendingImages],
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
        if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
        return prev.filter((p) => p.key !== key);
      });
    },
    [setPendingImages],
  );

  return { plate, addFiles, removeAttachment, registerAttachmentEl, endPlate };
}
