/**
 * Akar aplikasi KCG Code.
 *
 * Layout, navigasi, dan pemetaan URL -> halaman dipegang `AppShell`
 * (`components/layout/AppShell.tsx`) — pola yang sama dengan kcgcode
 * (`src/App.tsx` merender shell, halaman hidup di `src/pages/*`).
 */

import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { AuthGate } from "@/components/auth/AuthGate";
import { AppShell } from "@/components/layout/AppShell";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";

export function App() {
  // Kunci aplikasi: shell (dan semua request datanya) baru dirender setelah
  // lock screen dibuka.
  //
  // Motion (animasi masuk/keluar komponen):
  // - `LazyMotion` + `domAnimation` + komponen `m.*` (`motion/react-m`)
  //   menjaga bundle kecil (tanpa fitur drag/layout). `strict` melempar
  //   error bila ada yang tak sengaja memakai `motion.*` (bundle penuh).
  // - `reducedMotion="user"`: animasi transform dimatikan bila pengguna
  //   memilih reduce motion di sistemnya (opacity tetap).
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <AuthGate>
          <AppShell />
        </AuthGate>
        {/* Toast global (juga tampil di lock screen). Atas-tengah agar tidak
            menutupi kartu instalasi skill di kanan bawah. */}
        <Toaster position="top-center" closeButton />
      </MotionConfig>
    </LazyMotion>
  );
}

export default App;
