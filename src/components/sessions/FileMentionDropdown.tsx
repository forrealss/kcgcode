/**
 * Daftar saran autocomplete `@file` (di dalam `ComposerSuggestions`, di atas
 * input saat token @ aktif). Pemilihan lewat mousedown (bukan click) agar
 * textarea tidak blur duluan — logika state autocomplete tetap di
 * `useFileMention`.
 */
export interface FileMentionDropdownProps {
  loading: boolean;
  error: string | null;
  suggestions: string[];
  /** Indeks saran yang disorot (keyboard). */
  highlighted: number;
  /** Pilih saran ke-i (pemanggil menangani pemasukan teks + fokus). */
  onPick: (index: number) => void;
}

export function FileMentionDropdown({
  loading,
  error,
  suggestions,
  highlighted,
  onPick,
}: FileMentionDropdownProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Searching files…</div>}
      {!loading && error && <div className="px-3 py-2 text-xs text-destructive">{error}</div>}
      {suggestions.map((file, i) => (
        <button
          key={file}
          type="button"
          className={`block w-full truncate px-3 py-2 text-left font-mono text-base ${
            i === highlighted ? "bg-accent text-accent-foreground" : ""
          }`}
          onMouseDown={(e) => {
            // mousedown (bukan click) agar textarea tidak blur duluan.
            e.preventDefault();
            onPick(i);
          }}
        >
          {file}
        </button>
      ))}
    </div>
  );
}
