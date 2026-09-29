/**
 * Tipe domain Project — direpresentasikan sebagai direktori kerja di dalam
 * Sandbox_Root (Requirement 10).
 */
export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  /**
   * Custom instruction Project — dikirim sebagai `system` di setiap prompt
   * ke opencode (ditambahkan di atas AGENTS.md / instruksi bawaan).
   * `null`/kosong = tanpa instruksi tambahan.
   */
  instructions?: string | null;
}
