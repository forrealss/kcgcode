/**
 * Settings -> Appearance (`/settings/appearance`):
 *
 * - Glow saat memproses: glow ala Siri di dasar layar Session selama model
 *   merespon (`ProcessingGlow`). Default mati; preferensi per perangkat
 *   (`lib/appearance`).
 */
import { SparklesIcon } from "lucide-react";
import { PrefsGroup, SwitchRow } from "@/components/settings/prefs";
import { setProcessingGlowEnabled, useProcessingGlow } from "@/lib/appearance";

export function AppearanceGroup() {
  const glow = useProcessingGlow();

  return (
    <PrefsGroup title="Animations">
      <SwitchRow
        id="processing-glow-switch"
        icon={
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&>svg]:size-[18px]"
          >
            <SparklesIcon />
          </span>
        }
        title="Glow while responding"
        subtitle="A colorful glow along the bottom of the screen while an agent is working. Applies to this device."
        checked={glow}
        onChange={setProcessingGlowEnabled}
      />
    </PrefsGroup>
  );
}
