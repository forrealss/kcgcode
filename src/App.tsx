/**
 * Akar aplikasi KCG Code.
 *
 * Layout, navigasi, dan pemetaan URL -> halaman dipegang `AppShell`
 * (`components/layout/AppShell.tsx`) — pola yang sama dengan kcgcode
 * (`src/App.tsx` merender shell, halaman hidup di `src/pages/*`).
 */

import { AuthGate } from "@/components/auth/AuthGate";
import { AppShell } from "@/components/layout/AppShell";
import "./index.css";

export function App() {
  // Kunci aplikasi: shell (dan semua request datanya) baru dirender setelah
  // lock screen dibuka.
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}

export default App;
