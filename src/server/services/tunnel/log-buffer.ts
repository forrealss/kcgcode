/**
 * Buffer log tunnel bergulir dengan kursor absolut, plus penyamaran secret.
 */

const MAX_LOG_LINES = 300;

// biome-ignore lint/suspicious/noControlCharactersInRegex: buang kode warna ANSI
const ANSI_RE = /\u001b\[[0-9;]*m/g;

export class TunnelLogBuffer {
  // Buffer log bergulir dengan kursor absolut: `total` = jumlah baris yang
  // pernah ditulis; baris pertama di `lines` berindeks `total - lines.length`.
  private readonly lines: string[] = [];
  private count = 0;

  /** @param secrets nilai yang wajib disamarkan saat ini (token/secret akun). */
  constructor(private readonly secrets: () => Array<string | undefined>) {}

  /** Jumlah baris yang pernah ditulis (= `logOffset`). */
  get total(): number {
    return this.count;
  }

  /** Tulis satu baris (arrow agar aman dioper sebagai callback). */
  readonly write = (line: string): void => {
    // Jangan pernah mencatat secret/token (frpc tidak mencetaknya, tapi jaga-jaga).
    let clean = line.replace(ANSI_RE, "").trimEnd();
    for (const s of this.secrets()) if (s) clean = clean.split(s).join("***");
    if (clean === "") return;
    this.lines.push(clean);
    if (this.lines.length > MAX_LOG_LINES) this.lines.splice(0, this.lines.length - MAX_LOG_LINES);
    this.count++;
  };

  read(from: number): { lines: string[]; next: number } {
    const total = this.count;
    const first = total - this.lines.length;
    const startAt = Math.min(Math.max(from, first), total);
    return { lines: this.lines.slice(startAt - first), next: total };
  }
}
