/**
 * Dropdown saran autocomplete `@file` (muncul di atas input saat token @
 * aktif). Pemilihan lewat mousedown (bukan click) agar textarea tidak blur
 * duluan — logika state autocomplete tetap di `useFileMention`.
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
    <div className="absolute bottom-full left-0 right-0 z-10 mb-2 overflow-hidden rounded-xl border bg-popover shadow-md">
      <div className="max-h-56 overflow-y-auto">
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
    </div>
  );
}
