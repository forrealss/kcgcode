# Dokumen Requirements

## Pendahuluan

KCG Bridge adalah aplikasi Web Bridge / Control Panel berbasis Bun yang menjembatani CLI AI Agent (seperti OpenCode dan Claude Code) yang berjalan di server, sehingga dapat dikontrol secara interaktif dari perangkat mobile melalui browser. Aplikasi ini menjalankan CLI Agent sebagai proses pseudo-terminal yang tetap berjalan di background meskipun koneksi browser terputus, menyimpan seluruh riwayat output dan status sesi secara persisten menggunakan SQLite, dan menyediakan antarmuka PWA yang mobile-friendly untuk streaming output real-time, deteksi prompt interaktif, serta kemampuan reattach kapan saja. Aplikasi ini dibangun di atas template Bun + React + Tailwind + shadcn yang sudah ada di root workspace.

## Glossary

- **KCG_Bridge**: Sistem backend berbasis Bun yang menjembatani CLI_Agent dengan Client melalui WebSocket_Gateway dan Session_Store.
- **CLI_Agent**: Proses command-line AI agent (contoh: OpenCode, Claude Code) yang dijalankan oleh KCG_Bridge sebagai PTY_Process.
- **PTY_Process**: Proses pseudo-terminal yang menjalankan CLI_Agent, memungkinkan CLI_Agent menerima input interaktif dan menghasilkan output terminal.
- **Session**: Representasi satu instance CLI_Agent yang berjalan, terdiri dari identitas unik, status (running, stopped, crashed), working directory, dan riwayat Output_Stream.
- **Session_Manager**: Komponen backend KCG_Bridge yang mengelola lifecycle Session, meliputi pembuatan, penghentian, pendaftaran ulang, dan pencatatan status Session.
- **Session_Store**: Lapisan persistensi menggunakan bun:sqlite yang menyimpan data Session, Output_Stream, dan Interactive_Prompt secara permanen di disk.
- **Output_Stream**: Aliran data teks yang dihasilkan oleh PTY_Process, termasuk output standar dan proses thinking dari CLI_Agent.
- **WebSocket_Gateway**: Komponen backend yang menangani koneksi WebSocket antara Client dan Session_Manager untuk transmisi Output_Stream dan Interactive_Prompt secara real-time.
- **Client**: Antarmuka pengguna berbasis browser (PWA) yang digunakan pengguna untuk membuat, memantau, dan berinteraksi dengan Session.
- **Prompt_Detector**: Komponen backend yang menganalisis Output_Stream untuk mendeteksi pola Interactive_Prompt (konfirmasi y/n, izin eksekusi command, edit file, atau pilihan menu).
- **Interactive_Prompt**: Data terstruktur hasil deteksi Prompt_Detector yang merepresentasikan permintaan respon dari CLI_Agent kepada pengguna, memiliki tipe (confirmation, menu, free-text) dan daftar opsi jika tersedia.
- **Reattach**: Proses Client menyambungkan kembali ke Session yang sudah berjalan, termasuk pengambilan riwayat Output_Stream dari Session_Store dan penerimaan Output_Stream terbaru secara real-time.
- **PWA_Shell**: Bagian frontend KCG_Bridge yang menyediakan web app manifest dan service worker agar Client dapat di-install sebagai Progressive Web App.
- **Project**: Entitas yang merepresentasikan konteks kerja pengguna, terdiri dari nama unik dan path direktori kerja (working directory) di server, yang menjadi basis pembuatan Session.
- **Config_File**: Berkas konfigurasi KCG_Bridge yang dibaca saat proses server KCG_Bridge dimulai, memuat pengaturan termasuk Sandbox_Root.
- **Sandbox_Root**: Direktori dasar di server yang nilainya ditentukan melalui Config_File, yang membatasi ruang lingkup direktori yang dapat dijelajahi oleh Folder_Browser serta dipilih atau dibuat sebagai path suatu Project.
- **Folder_Browser**: Komponen yang memungkinkan pengguna menjelajahi struktur direktori asli di server, terbatas pada Sandbox_Root, untuk memilih atau menentukan path suatu Project.

## Requirements

### Requirement 1: Pembuatan dan Pengelolaan Session CLI Agent

**User Story:** Sebagai pengguna, saya ingin membuat Session CLI_Agent baru dari Client, sehingga saya dapat memulai proses AI Agent di server tanpa mengakses terminal secara langsung.

#### Acceptance Criteria

1. WHEN pengguna mengirim permintaan pembuatan Session baru dengan tipe CLI_Agent yang didukung dan identitas Project yang valid, THE Session_Manager SHALL membuat Session baru menggunakan path direktori kerja milik Project tersebut, dengan status "running", dan mengembalikan identitas unik Session tersebut.
2. WHEN Session baru dibuat, THE Session_Manager SHALL menjalankan CLI_Agent sebagai PTY_Process yang terasosiasi dengan Session tersebut.
3. IF permintaan pembuatan Session menyertakan tipe CLI_Agent yang tidak didukung, THEN THE Session_Manager SHALL menolak permintaan dan mengembalikan pesan error yang menjelaskan tipe CLI_Agent tidak didukung.
4. IF PTY_Process gagal dijalankan saat pembuatan Session, THEN THE Session_Manager SHALL menandai Session tersebut dengan status "crashed", mengembalikan pesan error yang menjelaskan proses CLI_Agent gagal dijalankan, dan tidak menandai Session tersebut sebagai "running" di Session_Store.
5. WHEN pengguna meminta daftar Session, THE Session_Manager SHALL mengembalikan seluruh Session yang tersimpan di Session_Store beserta status masing-masing.
6. WHEN pengguna mengirim permintaan penghentian Session yang berstatus "running", THE Session_Manager SHALL mengirim sinyal penghentian ke PTY_Process terkait, memaksa penghentian PTY_Process apabila belum berhenti dalam 5 detik sejak sinyal dikirim, dan mengubah status Session menjadi "stopped" setelah PTY_Process berhenti.
7. IF pengguna mengirim permintaan penghentian Session dengan identitas yang tidak ditemukan di Session_Store, atau Session tersebut berstatus selain "running", THEN THE Session_Manager SHALL menolak permintaan dan mengembalikan pesan error yang menjelaskan Session tidak ditemukan atau tidak sedang berjalan.
8. IF PTY_Process dari suatu Session berhenti atau keluar dengan kode keluar bukan nol tanpa didahului permintaan penghentian dari Session_Manager, THEN THE Session_Manager SHALL mengubah status Session menjadi "crashed" dan mencatat waktu kejadian di Session_Store.

### Requirement 2: Persistensi Proses di Background

**User Story:** Sebagai pengguna, saya ingin CLI_Agent tetap berjalan di server meskipun saya menutup browser di HP, sehingga proses AI Agent tidak terputus saat koneksi hilang.

#### Acceptance Criteria

1. WHILE tidak ada Client yang terhubung ke suatu Session melalui WebSocket_Gateway, THE PTY_Process dari Session tersebut SHALL tetap berjalan tanpa dihentikan oleh KCG_Bridge.
2. WHILE PTY_Process dari suatu Session masih aktif setelah koneksi WebSocket antara Client dan Session tersebut terputus, THE Session_Manager SHALL mempertahankan status Session sebagai "running".
3. WHEN KCG_Bridge menerima sinyal shutdown proses server, THE Session_Manager SHALL menyimpan status terakhir setiap Session yang masih berjalan ke Session_Store dalam waktu maksimal 5 detik sebelum proses server berhenti.
4. WHEN KCG_Bridge memulai proses server dan menemukan Session dengan status "running" di Session_Store namun PTY_Process yang terasosiasi dengan Session tersebut tidak lagi ada, THE Session_Manager SHALL mengubah status Session tersebut menjadi "crashed" dan mencatat waktu kejadian di Session_Store.

### Requirement 3: Persistensi Riwayat Output dan Status

**User Story:** Sebagai pengguna, saya ingin seluruh log output dan status Session tersimpan secara persisten, sehingga saya dapat melihat riwayat penuh meskipun server sempat direstart.

#### Acceptance Criteria

1. WHEN PTY_Process dari suatu Session menghasilkan potongan Output_Stream, THE Session_Store SHALL menyimpan potongan Output_Stream tersebut beserta timestamp dan identitas Session terkait.
2. IF Session_Store gagal menyimpan potongan Output_Stream atau perubahan status Session, THEN THE Session_Store SHALL mengembalikan indikasi kegagalan penyimpanan kepada pemanggil dan TIDAK menghapus data Output_Stream atau status Session yang sudah tersimpan sebelumnya.
3. WHEN status suatu Session berubah, THE Session_Store SHALL menyimpan status baru beserta timestamp perubahan tanpa menghapus atau menimpa riwayat status sebelumnya dari Session tersebut.
4. WHEN Output_Stream suatu Session dibaca berdasarkan identitas Session, THE Session_Store SHALL mengembalikan potongan-potongan Output_Stream dalam urutan yang identik dengan urutan penyimpanannya (round-trip property).
5. IF identitas Session yang diminta untuk membaca Output_Stream atau riwayat status tidak ditemukan di Session_Store, THEN THE Session_Store SHALL mengembalikan indikasi bahwa Session tidak ditemukan tanpa mengembalikan data Output_Stream atau status apa pun.
6. WHEN server yang menjalankan Session_Store direstart, THE Session_Store SHALL menyediakan kembali seluruh Output_Stream dan riwayat status Session yang tersimpan sebelum restart, identik dengan data sebelum restart.

### Requirement 4: Reattach dan Sinkronisasi Otomatis

**User Story:** Sebagai pengguna, saya ingin saat membuka kembali Client di HP, riwayat log otomatis tersinkronisasi kembali, sehingga saya tidak kehilangan konteks percakapan dengan CLI_Agent.

#### Acceptance Criteria

1. WHEN Client membuka koneksi WebSocket ke suatu Session yang sudah ada, THE WebSocket_Gateway SHALL mengirimkan riwayat Output_Stream dari Session_Store kepada Client dalam urutan yang sama seperti urutan penyimpanannya di Session_Store (round-trip order) sebelum mengirimkan Output_Stream baru apa pun.
2. WHEN proses Reattach selesai mengirimkan seluruh riwayat Output_Stream hingga offset terakhir yang telah dikirim ke Client tersebut, THE WebSocket_Gateway SHALL melanjutkan pengiriman Output_Stream baru dari PTY_Process secara real-time dengan hanya mengirimkan data yang dihasilkan setelah offset terakhir tersebut, sehingga tidak ada bagian Output_Stream yang dikirim lebih dari satu kali kepada Client yang sama.
3. IF Client mencoba melakukan Reattach ke identitas Session yang tidak ditemukan di Session_Store, THEN THE WebSocket_Gateway SHALL mengirimkan pesan error yang menjelaskan Session tidak ditemukan kepada Client sebelum menutup koneksi.
4. WHEN proses Reattach ke suatu Session selesai mengirimkan riwayat Output_Stream, THE WebSocket_Gateway SHALL mengirimkan seluruh Interactive_Prompt milik Session tersebut yang belum berstatus "resolved" kepada Client.

### Requirement 5: Streaming Output Real-Time

**User Story:** Sebagai pengguna, saya ingin melihat output dan thinking process CLI_Agent secara real-time di Client, sehingga saya dapat memantau progres tanpa delay berarti.

#### Acceptance Criteria

1. WHEN PTY_Process menghasilkan data Output_Stream baru, THE WebSocket_Gateway SHALL mengirimkan data tersebut ke seluruh Client yang terhubung ke Session terkait dalam urutan yang sama dengan urutan Output_Stream tersebut dihasilkan, paling lambat 500 milidetik sejak data dihasilkan.
2. WHILE beberapa Client terhubung ke Session yang sama, THE WebSocket_Gateway SHALL mengirimkan seluruh potongan Output_Stream yang identik dan dalam urutan yang sama ke setiap Client tersebut, tanpa ada potongan yang dilewati atau digandakan untuk salah satu Client.
3. IF WebSocket_Gateway gagal mengirimkan Output_Stream ke suatu Client karena koneksi Client tersebut terputus atau tidak responsif, THEN THE WebSocket_Gateway SHALL menghentikan pengiriman ke Client tersebut tanpa menghentikan atau menunda pengiriman Output_Stream ke Client lain yang masih terhubung ke Session yang sama.

### Requirement 6: Deteksi dan Respon Prompt Interaktif

**User Story:** Sebagai pengguna, saya ingin prompt interaktif dari CLI_Agent (seperti konfirmasi y/n atau izin eksekusi command) ditampilkan sebagai tombol di Client, sehingga saya dapat merespon dengan cepat dari HP.

#### Acceptance Criteria

1. WHEN Output_Stream dari suatu Session mengandung pola prompt konfirmasi y/n, izin eksekusi command, atau edit file, THE Prompt_Detector SHALL membuat Interactive_Prompt baru bertipe "confirmation" dan mengirimkannya ke Client melalui WebSocket_Gateway dalam waktu 500 milidetik setelah pola tersebut terdeteksi di Output_Stream.
2. WHEN Output_Stream dari suatu Session mengandung pola pilihan menu, THE Prompt_Detector SHALL membuat Interactive_Prompt baru bertipe "menu" yang menyertakan daftar opsi yang tersedia, dan mengirimkannya ke Client melalui WebSocket_Gateway dalam waktu 500 milidetik setelah pola tersebut terdeteksi di Output_Stream.
3. WHEN pengguna mengirim respon Approve, Deny, atau salah satu opsi menu yang terdaftar untuk suatu Interactive_Prompt, THE Session_Manager SHALL meneruskan respon tersebut sebagai input ke PTY_Process dari Session terkait.
4. WHEN respon terhadap suatu Interactive_Prompt telah diteruskan ke PTY_Process, THE Session_Manager SHALL menandai Interactive_Prompt tersebut sebagai "resolved" di Session_Store.
5. IF pengguna mengirim respon untuk Interactive_Prompt yang identitasnya sudah berstatus "resolved", THEN THE Session_Manager SHALL menolak respon tersebut dan mengembalikan pesan error yang menjelaskan Interactive_Prompt sudah diselesaikan.
6. IF pengguna mengirim respon untuk identitas Interactive_Prompt yang tidak ditemukan di Session_Store, atau mengirim pilihan menu yang bukan bagian dari daftar opsi Interactive_Prompt bertipe "menu" tersebut, THEN THE Session_Manager SHALL menolak respon tersebut dan mengembalikan pesan error yang menjelaskan identitas tidak ditemukan atau pilihan tidak valid.
7. WHEN pengguna mengirim respon Cancel untuk suatu Interactive_Prompt, THE Session_Manager SHALL menandai Interactive_Prompt tersebut sebagai "resolved" di Session_Store tanpa meneruskan input apapun ke PTY_Process dari Session terkait.

### Requirement 7: Input Interaktif Bebas dari Pengguna

**User Story:** Sebagai pengguna, saya ingin dapat mengirim prompt tambahan atau menjawab pertanyaan CLI_Agent kapan saja melalui input field, sehingga saya bisa melanjutkan percakapan tanpa harus menunggu Interactive_Prompt terdeteksi.

#### Acceptance Criteria

1. WHEN pengguna mengirim teks dengan panjang 1 hingga 10.000 karakter melalui input field pada Session yang berstatus "running", THE Session_Manager SHALL meneruskan teks tersebut beserta satu karakter newline di akhir sebagai input ke PTY_Process dari Session terkait.
2. IF pengguna mengirim teks kosong atau teks yang hanya berisi whitespace melalui input field, THEN THE Session_Manager SHALL menolak pengiriman dan mengembalikan pesan error yang menjelaskan teks tidak boleh kosong.
3. IF pengguna mengirim teks dengan panjang lebih dari 10.000 karakter melalui input field, THEN THE Session_Manager SHALL menolak pengiriman dan mengembalikan pesan error yang menjelaskan batas maksimum panjang teks terlampaui.
4. IF pengguna mengirim teks melalui input field pada Session yang berstatus "stopped" atau "crashed", THEN THE Session_Manager SHALL menolak pengiriman dan mengembalikan pesan error yang menjelaskan Session tidak aktif.
5. WHEN pengguna mengirim teks melalui input field pada Session yang memiliki Interactive_Prompt yang belum "resolved", THE Session_Manager SHALL meneruskan teks tersebut ke PTY_Process tanpa mengubah status Interactive_Prompt tersebut.

### Requirement 8: Antarmuka Mobile-Friendly dan PWA

**User Story:** Sebagai pengguna, saya ingin mengakses KCG_Bridge sebagai aplikasi PWA dengan tampilan yang responsif dan nyaman digunakan di layar smartphone, sehingga pengalaman kontrol CLI_Agent dari HP tetap mudah.

#### Acceptance Criteria

1. THE PWA_Shell SHALL menyediakan web app manifest dan service worker sebagai prasyarat instalasi, sehingga Client dapat di-install sebagai Progressive Web App pada perangkat mobile.
2. WHEN pengguna mengaktifkan mode gelap melalui kontrol pengaturan tampilan pada Client, THE Client SHALL mengubah tema antarmuka menjadi dark mode.
3. WHEN pengguna menekan toggle collapsible pada bagian thinking process suatu pesan, THE Client SHALL mengubah status tampilan konten thinking process pesan tersebut antara tampil dan tersembunyi secara independen dari pesan lain, dengan status default tampil (expanded) sebelum toggle pertama kali ditekan untuk pesan tersebut.
4. WHEN suatu Interactive_Prompt bertipe confirmation diterima Client, THE Client SHALL menampilkan tombol aksi cepat "Approve", "Deny", dan "Cancel" untuk Interactive_Prompt tersebut.
5. WHEN pengguna menekan tombol "Cancel" pada suatu Interactive_Prompt, THE Client SHALL memperlakukan penekanan tersebut sebagai respon Deny dan meneruskannya mengikuti mekanisme penyelesaian Interactive_Prompt sebagaimana didefinisikan pada Requirement 6 Acceptance Criteria 2 dan 3.
6. WHEN Client dibuka kembali setelah pengguna sebelumnya mengaktifkan mode gelap pada perangkat yang sama, THE Client SHALL menerapkan tema dark mode secara otomatis berdasarkan preferensi yang tersimpan dari sesi sebelumnya.
7. THE Client SHALL menampilkan antarmuka yang tetap responsif dan dapat digunakan tanpa elemen terpotong atau scroll horizontal pada lebar viewport 320 piksel hingga 1024 piksel.

### Requirement 9: Akses Jaringan Terbatas

**User Story:** Sebagai pengguna, saya ingin KCG_Bridge hanya dapat diakses melalui jaringan lokal atau VPN, sehingga kontrol terhadap CLI_Agent tidak terekspos ke internet publik.

#### Acceptance Criteria

1. THE KCG_Bridge SHALL menjalankan server HTTP dan WebSocket pada interface jaringan yang alamatnya dapat dikonfigurasi melalui environment variable, dengan nilai default berupa alamat loopback (localhost) apabila environment variable tersebut tidak diatur, sehingga server tidak terikat ke seluruh interface jaringan publik secara default.
2. WHERE environment variable otentikasi diaktifkan, THE KCG_Bridge SHALL mewajibkan setiap permintaan HTTP dan setiap permintaan pembukaan koneksi WebSocket menyertakan kredensial yang sesuai dengan kredensial yang telah dikonfigurasi melalui environment variable.
3. IF environment variable otentikasi diaktifkan dan suatu permintaan HTTP atau permintaan pembukaan koneksi WebSocket tidak menyertakan kredensial atau menyertakan kredensial yang tidak sesuai dengan kredensial terkonfigurasi, THEN THE KCG_Bridge SHALL menolak permintaan atau koneksi tersebut tanpa memprosesnya lebih lanjut dan mengembalikan pesan error yang menjelaskan bahwa otentikasi gagal.

### Requirement 10: Pengelolaan Project dan Pemilihan Path Sandbox

**User Story:** Sebagai pengguna, saya ingin memilih atau membuat Project beserta path direktori kerjanya melalui folder chooser yang dibatasi pada direktori tertentu, sehingga setiap Session yang saya buat selalu terhubung ke konteks kerja yang jelas dan aman tanpa mengekspos seluruh filesystem server.

#### Acceptance Criteria

1. THE KCG_Bridge SHALL membaca nilai Sandbox_Root dari Config_File saat proses server dimulai, dan menolak untuk memulai apabila nilai Sandbox_Root tidak diatur atau direktori yang ditunjuk tidak ditemukan di server.
2. WHEN pengguna meminta daftar isi direktori melalui Folder_Browser untuk suatu path di dalam Sandbox_Root, THE Folder_Browser SHALL mengembalikan daftar sub-direktori dari path tersebut tanpa mengembalikan isi direktori apa pun di luar Sandbox_Root.
3. IF pengguna meminta daftar isi direktori melalui Folder_Browser untuk suatu path yang berada di luar Sandbox_Root, termasuk path yang mengandung referensi direktori induk (".."), path absolut di luar Sandbox_Root, atau tautan simbolik yang mengarah ke luar Sandbox_Root, THEN THE Folder_Browser SHALL menolak permintaan tersebut dan mengembalikan pesan error yang menjelaskan path berada di luar Sandbox_Root.
4. WHEN pengguna mengirim permintaan pembuatan Project baru dengan nama yang belum digunakan oleh Project lain dan path di dalam Sandbox_Root yang belum digunakan oleh Project lain, THE Session_Manager SHALL membuat Project baru dengan nama dan path tersebut, membuat direktori pada path tersebut apabila direktori belum ada, dan menyimpan Project baru tersebut ke Session_Store.
5. IF pengguna mengirim permintaan pembuatan Project baru dengan nama yang sudah digunakan oleh Project lain, THEN THE Session_Manager SHALL menolak permintaan dan mengembalikan pesan error yang menjelaskan nama Project sudah digunakan.
6. IF pengguna mengirim permintaan pembuatan Project baru dengan path yang sudah digunakan oleh Project lain, THEN THE Session_Manager SHALL menolak permintaan dan mengembalikan pesan error yang menjelaskan path sudah digunakan oleh Project lain.
7. IF pengguna mengirim permintaan pembuatan Project baru dengan path di luar Sandbox_Root atau path yang mengandung karakter yang tidak valid untuk nama direktori pada sistem operasi server, THEN THE Session_Manager SHALL menolak permintaan dan mengembalikan pesan error yang menjelaskan path tidak valid.
8. WHEN pengguna meminta daftar Project, THE Session_Manager SHALL mengembalikan seluruh Project yang tersimpan di Session_Store beserta nama dan path masing-masing.
9. WHEN pengguna memilih Project yang sudah ada dari daftar Project sebagai bagian dari permintaan pembuatan Session baru, THE Session_Manager SHALL menggunakan path direktori kerja milik Project tersebut untuk pembuatan Session tanpa memerlukan pengguna memasukkan path secara manual.
10. IF pengguna mengirim permintaan pembuatan Session baru dengan identitas Project yang tidak ditemukan di Session_Store, THEN THE Session_Manager SHALL menolak permintaan dan mengembalikan pesan error yang menjelaskan Project tidak ditemukan.
11. IF path direktori kerja milik suatu Project tidak lagi ditemukan di server pada saat permintaan pembuatan Session menggunakan Project tersebut, THEN THE Session_Manager SHALL menolak permintaan dan mengembalikan pesan error yang menjelaskan direktori Project tidak ditemukan.
