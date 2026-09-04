/**
 * Tipe domain Project — direpresentasikan sebagai direktori kerja di dalam
 * Sandbox_Root (Requirement 10).
 */
export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}
