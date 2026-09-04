/**
 * Akar aplikasi KCG Bridge.
 *
 * Layout, navigasi, dan pemetaan URL -> halaman dipegang `AppShell`
 * (`components/layout/AppShell.tsx`) — pola yang sama dengan kcgrouter
 * (`src/App.tsx` merender shell, halaman hidup di `src/pages/*`).
 */

import { AppShell } from "@/components/layout/AppShell";
import "./index.css";

export function App() {
  return <AppShell />;
}

export default App;
