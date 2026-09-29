/**
 * Kontrol toggle dark mode (Requirement 8.2) memakai `useTheme.ts`.
 * Tema disimpan di `localStorage["kcg-theme"]` dan diterapkan ke `<html>`
 * (Requirement 8.6) oleh hook.
 *
 * Dirender sebagai item menu di footer sidebar (`AppSidebar`): label
 * menyebut mode tujuan, ikon mengikuti mode tujuan.
 */
import { MoonIcon, SunIcon } from "lucide-react";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { useTheme } from "@/hooks/useTheme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Light mode" : "Dark mode";

  return (
    <SidebarMenuButton type="button" onClick={toggleTheme} tooltip={label}>
      {isDark ? <SunIcon /> : <MoonIcon />}
      <span>{label}</span>
    </SidebarMenuButton>
  );
}
