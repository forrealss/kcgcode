/**
 * Akar aplikasi KCG Code.
 *
 * Layout, navigasi, dan pemetaan URL -> halaman dipegang `AppShell`
 * (`components/layout/AppShell.tsx`) — pola yang sama dengan kcgcode
 * (`src/App.tsx` merender shell, halaman hidup di `src/pages/*`).
 */

import { AuthGate } from "@/components/auth/AuthGate";
import { AppShell } from "@/components/layout/AppShell";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";

export function App() {
  // Kunci aplikasi: shell (dan semua request datanya) baru dirender setelah
  // lock screen dibuka.
  return (
    <>
      <AuthGate>
        <AppShell />
      </AuthGate>
      {/* Toast global (juga tampil di lock screen). Atas-tengah agar tidak
          menutupi kartu instalasi skill di kanan bawah. */}
      <Toaster position="top-center" closeButton />
    </>
  );
}

export default App;
