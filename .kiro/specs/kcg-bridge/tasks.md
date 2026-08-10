# Rencana Implementasi: KCG Bridge

## Overview

Rencana ini memecah desain KCG Bridge menjadi langkah-langkah coding inkremental: mulai dari tipe domain bersama, `config.ts`/`Sandbox_Root`, skema `bun:sqlite` (`Session_Store`), `sandbox.ts` & `Project_Manager`/`Folder_Browser`, `PTY_Process` wrapper (`Bun.Terminal` + `Bun.spawn`), `Session_Manager` (lifecycle & rekonsiliasi), `Prompt_Detector`, `WebSocket_Gateway` (protokol, reattach, broadcast), middleware `auth.ts`, `PWA_Shell`, hingga komponen frontend (project list, folder browser, session list, session view, prompt card, theme toggle) dan wiring akhir di `App.tsx`/`src/index.ts`. Setiap langkah membangun di atas langkah sebelumnya dan diakhiri dengan pengujian, tanpa ada kode yang menggantung tanpa terhubung ke keseluruhan sistem.

Seluruh 30 Correctness Properties pada `design.md` diimplementasikan sebagai property test **fast-check** (`fc.assert(fc.property(...), { numRuns: 100 })`, tag `// Feature: kcg-bridge, Property N: <judul>`) yang ditempatkan tepat setelah implementasi terkait. Requirement yang menurut `design.md` bagian Testing Strategy **tidak** dijadikan property (1.4, 1.6, 2.1, 2.3, 3.2, 3.6, 8.1, 8.2, 8.4, 8.5, 8.6, 9.1, 10.1) diberi unit/integration test tersendiri. Requirement 8.7 tidak diberi task otomatisasi karena `design.md` secara eksplisit mencatatnya sebagai verifikasi visual/manual di luar cakupan PBT/unit test.

## Tasks

- [ ] 1. Setup tipe domain & protokol WebSocket bersama
  - [ ] 1.1 Buat `src/server/types.ts` dan `src/server/ws-protocol.ts`
    - Definisikan tipe `Project`, `Session`, `AgentType`, `SessionStatus`, `OutputChunk`, `InteractivePrompt`, `PromptResponse` sesuai `design.md` bagian Data Models
    - Definisikan tipe pesan WebSocket Client->Server (`attach`, `input`, `prompt_response`, `resize`) dan Server->Client (`history`, `output`, `prompt`, `prompt_resolved`, `session_status`, `error`) sesuai tabel protokol di `design.md`
    - _Requirements: 1.1, 4.4, 5.1, 6.1, 6.2_

- [ ] 2. Implementasi Config_File & validasi Sandbox_Root saat startup
  - [ ] 2.1 Buat `src/server/config.ts`
    - Baca `kcg-bridge.config.json` (path dapat dioverride via `KCG_CONFIG_PATH`), resolve `sandboxRoot` dengan `fs.realpath`
    - Exit proses dengan kode error dan log jelas apabila `sandboxRoot` tidak diatur atau direktori tidak ditemukan
    - _Requirements: 10.1_

  - [ ]* 2.2 Tulis unit test `config.ts`
    - Kasus: field `sandboxRoot` hilang, direktori tidak ditemukan, dan konfigurasi valid
    - _Requirements: 10.1_

- [ ] 3. Implementasi skema & koneksi Session_Store
  - [ ] 3.1 Buat `src/server/db.ts` — koneksi `bun:sqlite`, `PRAGMA journal_mode = WAL`, dan migrasi `CREATE TABLE IF NOT EXISTS` untuk `projects`, `sessions`, `session_status_history`, `output_stream`, `prompts` sesuai skema di `design.md`
    - _Requirements: 3.1, 3.3_

- [ ] 4. Implementasi fungsi Session_Store untuk Output_Stream & riwayat status (append-only)
  - [ ] 4.1 Tambahkan ke `db.ts`: fungsi insert-only `insertOutputChunk`/`getOutputChunks` (terurut `seq`) dan `insertStatusHistory`/`getStatusHistory`, mengembalikan tipe hasil `{ ok, error }` tanpa pernah `UPDATE`/`DELETE` baris yang sudah ada, serta indikasi "tidak ditemukan" saat `sessionId` tidak ada
    - _Requirements: 3.1, 3.3, 3.5_

  - [ ]* 4.2 Tulis property test round-trip Output_Stream & query tidak ditemukan
    - **Property 8: Round-trip penyimpanan Output_Stream** — **Validates: Requirements 3.1, 3.4**
    - **Property 10: Query terhadap Session tidak ditemukan** — **Validates: Requirements 3.5**

  - [ ]* 4.3 Tulis property test riwayat status append-only
    - **Property 9: Riwayat status bersifat append-only** — **Validates: Requirements 3.3**

  - [ ]* 4.4 Tulis integration test kegagalan tulis storage & persistensi setelah restart
    - Simulasikan kegagalan tulis (mis. disk penuh/mock exception) dan pastikan data lama tidak terhapus; buka ulang koneksi `bun:sqlite` pada file yang sama dan pastikan data sebelumnya tetap terbaca identik
    - _Requirements: 3.2, 3.6_

- [ ] 5. Implementasi fungsi Session_Store untuk entitas Session, Project, Prompt
  - [ ] 5.1 Tambahkan ke `db.ts`: fungsi CRUD `sessions` (insert, update status, get, list), `projects` (insert, get by name/path, list), `prompts` (insert, get, list pending, update status)
    - _Requirements: 1.5, 1.7, 6.4, 6.5, 6.6, 10.4, 10.5, 10.6, 10.8_

- [ ] 6. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implementasi validator Sandbox_Root
  - [ ] 7.1 Buat `src/server/sandbox.ts` — fungsi `resolveWithinSandbox(sandboxRoot, userPath)`: tolak segmen `..` sebelum resolusi, `fs.realpath` mengikuti symlink, verifikasi hasil berada di dalam `sandboxRoot`, dan validasi karakter terlarang OS untuk nama direktori
    - _Requirements: 10.2, 10.3, 10.7_

  - [ ]* 7.2 Tulis property test validasi sandbox
    - **Property 27: Folder_Browser mengembalikan persis sub-direktori dalam sandbox** — **Validates: Requirements 10.2**
    - **Property 28: Path di luar Sandbox_Root selalu ditolak** — **Validates: Requirements 10.3, 10.7**

- [ ] 8. Implementasi Project_Manager & Folder_Browser
  - [ ] 8.1 Buat `src/server/project-manager.ts` — `listDirectory`, `createProject`, `listProjects`, seluruhnya memakai `sandbox.ts` untuk validasi path sebelum operasi filesystem apa pun dan `db.ts` untuk persistensi
    - _Requirements: 10.2, 10.4, 10.5, 10.6, 10.8_

  - [ ]* 8.2 Tulis property test pembuatan Project
    - **Property 29: Pembuatan Project unik berhasil round-trip** — **Validates: Requirements 10.4**
    - **Property 30: Nama atau path Project duplikat selalu ditolak** — **Validates: Requirements 10.5, 10.6**

  - [ ]* 8.3 Tulis unit test edge case path & nama Project
    - Kasus: path mengandung `"../etc"`, path absolut di luar sandbox, nama direktori dengan karakter unicode, nama dengan karakter terlarang OS
    - _Requirements: 10.3, 10.7_

- [ ] 9. Implementasi wrapper PTY_Process
  - [ ] 9.1 Buat `src/server/pty-process.ts` — `spawnPty(cmd, cwd)` memakai `new Bun.Terminal({...})` dipasangkan ke `Bun.spawn(cmd, { cwd, terminal })`, mengembalikan `PtyHandle` dengan `write`, `resize`, `kill(signal)`, `onData`, `onExit(code, expected)`
    - _Requirements: 1.2_

  - [ ]* 9.2 Tulis unit test wrapper `pty-process.ts`
    - Verifikasi `write`/`resize` diteruskan ke terminal mock, `onData` dipanggil saat data masuk, `onExit` membedakan `expected` true/false
    - _Requirements: 1.2_

- [ ] 10. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implementasi Session_Manager — pembuatan & daftar Session
  - [ ] 11.1 Buat `src/server/session-manager.ts` — `createSession(req)`: validasi `agentType` didukung, `Project` ada di store, direktori kerja Project ada di filesystem; jalankan `spawnPty`; simpan `Session` baru berstatus `"running"` hanya jika seluruh validasi dan spawn berhasil
    - _Requirements: 1.1, 1.2, 1.3, 10.9, 10.10, 10.11_

  - [ ]* 11.2 Tulis property test pembuatan Session
    - **Property 1: Pembuatan Session valid** — **Validates: Requirements 1.1, 1.2, 10.9**
    - **Property 2: Pembuatan Session dengan kondisi tidak valid selalu ditolak** — **Validates: Requirements 1.3, 10.10, 10.11**

  - [ ]* 11.3 Tulis unit test kegagalan spawn PTY_Process
    - Simulasikan `spawnPty` melempar error/proses langsung exit; pastikan Session ditandai `"crashed"` dengan pesan error dan tidak pernah tercatat `"running"` di Session_Store
    - _Requirements: 1.4_

  - [ ] 11.4 Tambahkan `listSessions()` ke `session-manager.ts` dan pastikan `project-manager.ts` mengekspos `listProjects()` yang konsisten dipakai bersama
    - _Requirements: 1.5, 10.8_

  - [ ]* 11.5 Tulis property test kelengkapan daftar
    - **Property 3: Daftar entitas selalu lengkap** — **Validates: Requirements 1.5, 10.8**

- [ ] 12. Implementasi Session_Manager — lifecycle (stop, exit, rekonsiliasi, shutdown)
  - [ ] 12.1 Tambahkan `stopSession(sessionId)` ke `session-manager.ts` — validasi Session ada & berstatus `"running"`, kirim `SIGTERM`, jadwalkan `setTimeout` 5 detik yang memanggil `kill("SIGKILL")` bila proses belum keluar, ubah status menjadi `"stopped"` setelah `PtyHandle` keluar
    - _Requirements: 1.6, 1.7_

  - [ ]* 12.2 Tulis property test penghentian Session tidak valid
    - **Property 4: Penghentian Session tidak valid selalu ditolak** — **Validates: Requirements 1.7**

  - [ ]* 12.3 Tulis unit test timing force-kill
    - Gunakan fake timer untuk memverifikasi `kill("SIGKILL")` hanya dipanggil setelah 5 detik sejak `SIGTERM` apabila proses belum keluar, dan tidak dipanggil bila proses keluar lebih awal
    - _Requirements: 1.6_

  - [ ] 12.4 Tambahkan handler `onExit` ke `session-manager.ts` — ubah status Session menjadi `"crashed"` dengan timestamp saat `PtyHandle` keluar dengan kode bukan nol tanpa didahului `stopSession`
    - _Requirements: 1.8_

  - [ ]* 12.5 Tulis property test exit tak terduga
    - **Property 5: Exit tak terduga menghasilkan status crashed** — **Validates: Requirements 1.8**

  - [ ] 12.6 Tambahkan `reconcileOnStartup()` ke `session-manager.ts` — tandai seluruh Session berstatus `"running"` di store yang tidak memiliki `PtyHandle` aktif di memori sebagai `"crashed"` dengan timestamp, dipanggil sekali sebelum server menerima koneksi
    - _Requirements: 2.4_

  - [ ]* 12.7 Tulis property test rekonsiliasi startup
    - **Property 7: Rekonsiliasi startup menandai Session tanpa proses sebagai crashed** — **Validates: Requirements 2.4**

  - [ ] 12.8 Tambahkan handler shutdown ke `session-manager.ts` — pada `process.on("SIGINT"/"SIGTERM")`, simpan status terakhir seluruh Session `"running"` ke `session_status_history` dibatasi anggaran waktu 5 detik memakai `Promise.race`
    - _Requirements: 2.3_

  - [ ]* 12.9 Tulis integration test persistensi proses & shutdown
    - Skenario: `PtyHandle` tetap hidup dan status tetap `"running"` selama tidak ada Client terhubung; shutdown menyimpan status seluruh Session `"running"` dalam anggaran waktu 5 detik
    - _Requirements: 2.1, 2.3_

- [ ] 13. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Implementasi Session_Manager — input bebas & Interactive_Prompt
  - [ ] 14.1 Tambahkan `sendFreeTextInput(sessionId, text)` ke `session-manager.ts` — validasi panjang 1-10.000 karakter dan bukan seluruhnya whitespace, validasi Session berstatus `"running"`, teruskan teks + `"\n"` ke `PtyHandle`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 14.2 Tulis property test input bebas
    - **Property 21: Free-text valid diteruskan utuh dengan newline** — **Validates: Requirements 7.1**
    - **Property 22: Free-text kosong atau melebihi batas selalu ditolak** — **Validates: Requirements 7.2, 7.3**
    - **Property 23: Free-text pada Session tidak aktif selalu ditolak** — **Validates: Requirements 7.4**
    - **Property 24: Free-text tidak mengubah status Interactive_Prompt** — **Validates: Requirements 7.5**

  - [ ] 14.3 Tambahkan `resolvePrompt(sessionId, promptId, response)` ke `session-manager.ts` — validasi prompt ada & `"pending"`, validasi opsi menu bila relevan; untuk `"approve"`/`"deny"`/opsi menu teruskan sebagai `write` ke `PtyHandle` dan tandai `"resolved"`; untuk `"cancel"` tandai `"resolved"` tanpa `write`
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7_

  - [ ]* 14.4 Tulis property test resolusi Interactive_Prompt
    - **Property 18: Respon valid diteruskan dan menandai prompt resolved** — **Validates: Requirements 6.3, 6.4**
    - **Property 19: Respon tidak valid selalu ditolak tanpa efek samping** — **Validates: Requirements 6.5, 6.6**
    - **Property 20: Respon Cancel tidak meneruskan input** — **Validates: Requirements 6.7**

- [ ] 15. Implementasi Prompt_Detector
  - [ ] 15.1 Buat `src/server/prompt-detector.ts` — `detectPrompt(bufferedText)`: kenali pola konfirmasi y/n, izin eksekusi command/edit file (tipe `"confirmation"`), dan pola menu bernomor (tipe `"menu"` dengan `options: string[]`)
    - _Requirements: 6.1, 6.2_

  - [ ]* 15.2 Tulis property test deteksi prompt
    - **Property 17: Deteksi pola Interactive_Prompt** — **Validates: Requirements 6.1, 6.2**

- [ ] 16. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Implementasi WebSocket_Gateway
  - [ ] 17.1 Buat `src/server/websocket-gateway.ts` — registry koneksi `Map<ws, { sessionId, lastSeqSent }>`; alur `attach`: validasi `sessionId` ada (jika tidak, kirim `error` lalu `close()`), kirim `history` terurut `seq`, set `lastSeqSent`, kirim `prompt` untuk seluruh prompt `"pending"`
    - _Requirements: 4.1, 4.3, 4.4_

  - [ ]* 17.2 Tulis property test reattach
    - **Property 11: Reattach mengirim riwayat sesuai urutan sebelum data baru** — **Validates: Requirements 4.1**
    - **Property 13: Reattach ke Session tidak ditemukan menghasilkan error** — **Validates: Requirements 4.3**
    - **Property 14: Reattach mengirim seluruh prompt belum resolved** — **Validates: Requirements 4.4**

  - [ ] 17.3 Tambahkan `broadcast(sessionId, chunk)` ke `websocket-gateway.ts` — iterasi subscriber `sessionId`, kirim hanya `chunk.seq > lastSeqSent`, update `lastSeqSent`, tangkap error `ws.send` per-subscriber (hapus subscriber gagal) tanpa menghentikan iterasi ke subscriber lain
    - _Requirements: 4.2, 5.1, 5.2, 5.3_

  - [ ]* 17.4 Tulis property test broadcast
    - **Property 12: Tidak ada duplikasi atau chunk terlewat setelah reattach** — **Validates: Requirements 4.2**
    - **Property 15: Broadcast konsisten ke banyak Client** — **Validates: Requirements 5.1, 5.2**
    - **Property 16: Kegagalan satu Client tidak memengaruhi Client lain** — **Validates: Requirements 5.3**

  - [ ] 17.5 Tambahkan wiring pesan `input`, `prompt_response`, `resize` di `websocket-gateway.ts` ke `session-manager.ts`, serta kirim notifikasi `session_status` dan `prompt_resolved` ke Client terkait
    - _Requirements: 6.3, 7.1_

  - [ ]* 17.6 Tulis property test status Session terhadap disconnect
    - **Property 6: Status Session tidak terpengaruh disconnect WebSocket** — **Validates: Requirements 2.2**

- [ ] 18. Implementasi middleware otentikasi
  - [ ] 18.1 Buat `src/server/auth.ts` — default `hostname` loopback via `process.env.KCG_HOST`; bila `KCG_AUTH_ENABLED === "true"`, validasi header `Authorization: Bearer <token>` (HTTP) atau `?token=` (upgrade WS) terhadap `KCG_AUTH_TOKEN`, tolak dengan HTTP 401 / WS close code 4401 bila tidak cocok
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ]* 18.2 Tulis property test otentikasi
    - **Property 26: Otentikasi konsisten terhadap kredensial** — **Validates: Requirements 9.2, 9.3**

  - [ ]* 18.3 Tulis unit test default bind jaringan
    - Kasus: `KCG_HOST` tidak diatur menghasilkan default loopback; `KCG_AUTH_ENABLED` tidak diatur berarti request diterima tanpa kredensial
    - _Requirements: 9.1_

- [ ] 19. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [ ] 20. Wiring server utama
  - [ ] 20.1 Perbarui `src/index.ts` — `Bun.serve({ hostname, port, routes, websocket })`: routes HTTP `/api/projects` (GET/POST), `/api/fs` (GET, Folder_Browser), `/api/sessions` (GET/POST/DELETE), pasang `auth.ts` di setiap route dan `upgrade` WS, panggil `reconcileOnStartup()` sebelum `Bun.serve` menerima koneksi, daftarkan handler shutdown
    - _Requirements: 1.1, 1.5, 1.6, 1.7, 4.1, 9.1, 9.2, 10.1, 10.2, 10.4, 10.8_

  - [ ]* 20.2 Tulis integration test end-to-end alur utama
    - Skenario dengan `PtyHandle` mock: buat Project -> buat Session -> `attach` via WebSocket -> terima `output` -> respon `Interactive_Prompt` -> `stopSession`
    - _Requirements: 1.1, 4.1, 5.1, 6.3_

- [ ] 21. Implementasi PWA_Shell
  - [ ] 21.1 Buat `public/manifest.json` — `name`, `short_name`, `start_url`, `display: "standalone"`, `icons` (berbasis `logo.svg` + varian PNG)
    - _Requirements: 8.1_

  - [ ] 21.2 Buat `public/sw.js` — strategi cache-first untuk asset statis, network-only untuk `/api/*` dan koneksi WebSocket
    - _Requirements: 8.1_

  - [ ] 21.3 Perbarui `src/frontend.tsx` (registrasi `navigator.serviceWorker?.register("/sw.js")`) dan `src/index.html` (`<link rel="manifest">`, meta `theme-color`)
    - _Requirements: 8.1_

  - [ ]* 21.4 Tulis unit test validitas `manifest.json`
    - Verifikasi field wajib (`name`, `short_name`, `start_url`, `display`, `icons`) ada dan bernilai valid
    - _Requirements: 8.1_

- [ ] 22. Implementasi hooks frontend
  - [ ] 22.1 Buat `src/hooks/use-theme.ts` — baca/tulis preferensi ke `localStorage["kcg-theme"]`, terapkan class `dark` di `<html>` saat mount berdasarkan nilai tersimpan, sediakan fungsi toggle
    - _Requirements: 8.2, 8.6_

  - [ ]* 22.2 Tulis unit test persistensi tema
    - Kasus: toggle mengubah tema saat ini (8.2); mount ulang dengan preferensi tersimpan menerapkan dark mode otomatis (8.6)
    - _Requirements: 8.2, 8.6_

  - [ ] 22.3 Buat `src/hooks/use-websocket.ts` — kelola koneksi `attach`/reconnect, dan handle pesan masuk `history`, `output`, `prompt`, `prompt_resolved`, `session_status`, `error` sesuai `ws-protocol.ts`
    - _Requirements: 4.1, 4.2, 5.1_

- [ ] 23. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [ ] 24. Implementasi komponen frontend
  - [ ] 24.1 Buat `src/components/theme-toggle.tsx` — kontrol toggle dark mode memakai `use-theme.ts`
    - _Requirements: 8.2_

  - [ ] 24.2 Buat `src/components/folder-browser.tsx` — panggil `GET /api/fs?path=...`, tampilkan breadcrumb + daftar sub-direktori, tombol "Pilih" mengisi path Project baru
    - _Requirements: 10.2, 10.3_

  - [ ] 24.3 Buat `src/components/project-list.tsx` — `GET/POST /api/projects`, form nama + integrasi `folder-browser.tsx`
    - _Requirements: 10.4, 10.5, 10.6, 10.7, 10.8_

  - [ ] 24.4 Buat `src/components/session-list.tsx` — `GET/POST /api/sessions`, pilih Project & tipe CLI_Agent
    - _Requirements: 1.1, 1.3, 1.5, 10.9, 10.10_

  - [ ] 24.5 Buat `src/components/prompt-card.tsx` — tombol "Approve"/"Deny"/"Cancel" untuk tipe `"confirmation"`, daftar opsi untuk tipe `"menu"`; klik "Cancel" memanggil handler yang sama dengan "Deny"
    - _Requirements: 8.4, 8.5_

  - [ ]* 24.6 Tulis unit test `prompt-card.tsx`
    - Verifikasi tombol Approve/Deny/Cancel tampil untuk tipe `"confirmation"` (8.4) dan klik "Cancel" memicu handler Deny yang sama sesuai mekanisme Requirement 6 (8.5)
    - _Requirements: 8.4, 8.5_

  - [ ] 24.7 Buat `src/components/session-view.tsx` — konsumen `use-websocket.ts`, render Output_Stream sebagai daftar pesan dengan collapsible thinking block per pesan (state `Record<messageId, boolean>`, default `true`/expanded), render `prompt-card.tsx` untuk Interactive_Prompt aktif, input field bebas
    - _Requirements: 5.1, 5.2, 6.1, 6.2, 7.1, 8.3_

  - [ ]* 24.8 Tulis property test toggle collapsible
    - **Property 25: Toggle collapsible thinking independen antar pesan** — **Validates: Requirements 8.3**

- [ ] 25. Wiring shell aplikasi
  - [ ] 25.1 Perbarui `src/App.tsx` — navigasi Project list -> Session list per Project -> Session view, integrasikan `use-theme.ts` dan seluruh komponen frontend
    - _Requirements: 1.1, 1.5, 8.2, 8.6, 10.8, 10.9_

- [ ] 26. Checkpoint akhir - Ensure all tests pass, ask the user if questions arise.

## Notes

- Task dengan postfix `*` bersifat opsional (test) dan dapat dilewati untuk MVP yang lebih cepat; task tersebut TIDAK diimplementasikan secara otomatis oleh agent eksekusi task.
- Requirement 8.7 (responsif tanpa elemen terpotong/scroll horizontal pada viewport 320px-1024px) sengaja tidak diberi task otomatisasi, karena `design.md` mencatatnya sebagai verifikasi visual/manual di luar cakupan property-based test maupun unit test.
- Seluruh property test memakai **fast-check** dengan minimum 100 iterasi (`{ numRuns: 100 }`) dan tag komentar `// Feature: kcg-bridge, Property N: <judul>` tepat di atas test, dijalankan lewat `bun test`.
- `PtyHandle` (Bun.Terminal/Bun.spawn) dan `WebSocket` (`ws.send`) di-mock pada seluruh property test dan sebagian besar unit test backend, sesuai batasan mocking pada `design.md`.
- Checkpoint ditempatkan setiap 3-5 task besar untuk validasi inkremental sebelum melanjutkan ke komponen berikutnya.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "21.1", "21.2", "22.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "9.1", "15.1", "21.3", "22.3", "24.2", "24.3", "24.4", "24.5"] },
    { "id": 2, "tasks": ["2.2", "4.1", "7.1", "9.2", "15.2", "21.4", "18.1", "22.2", "24.1", "24.6", "24.7"] },
    { "id": 3, "tasks": ["4.2", "4.3", "5.1", "7.2", "18.2", "18.3", "24.8", "25.1"] },
    { "id": 4, "tasks": ["4.4", "8.1", "11.1"] },
    { "id": 5, "tasks": ["8.2", "8.3", "11.2", "11.3", "11.4"] },
    { "id": 6, "tasks": ["11.5", "12.1"] },
    { "id": 7, "tasks": ["12.2", "12.3", "12.4"] },
    { "id": 8, "tasks": ["12.5", "12.6"] },
    { "id": 9, "tasks": ["12.7", "12.8"] },
    { "id": 10, "tasks": ["12.9", "14.1"] },
    { "id": 11, "tasks": ["14.2", "14.3"] },
    { "id": 12, "tasks": ["14.4", "17.1"] },
    { "id": 13, "tasks": ["17.2", "17.3"] },
    { "id": 14, "tasks": ["17.4", "17.5"] },
    { "id": 15, "tasks": ["17.6", "20.1"] },
    { "id": 16, "tasks": ["20.2"] }
  ]
}
```
