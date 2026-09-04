/**
 * Kontrol toggle dark mode (Requirement 8.2) memakai `useTheme.ts`.
 * Tema disimpan di `localStorage["kcg-theme"]` dan diterapkan ke `<html>`
 * (Requirement 8.6) oleh hook.
 */
import { MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={isDark ? "Aktifkan mode terang" : "Aktifkan mode gelap"}
      title={isDark ? "Mode terang" : "Mode gelap"}
    >
      {isDark ? <SunIcon data-icon="inline-start" /> : <MoonIcon data-icon="inline-start" />}
    </Button>
  );
}
