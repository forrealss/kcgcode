/**
 * Settings -> Appearance (`/settings/appearance`):
 *
 * - Glow saat memproses: glow ala Siri di dasar layar Session selama model
 *   merespon (`ProcessingGlow`). Default mati; preferensi per perangkat
 *   (`lib/appearance`).
 * - Estimasi biaya: harga estimasi tiap balasan di samping jumlah tokennya.
 *   Default mati (hanya estimasi; langganan tidak ditagih per token).
 */
import { CircleDollarSignIcon, SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";
import { PrefsGroup, SwitchRow } from "@/components/settings/prefs";
import {
  setProcessingGlowEnabled,
  setShowCostEnabled,
  useProcessingGlow,
  useShowCost,
} from "@/lib/appearance";

/** Ikon bundar baris preferensi. */
function RowIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&>svg]:size-[18px]"
    >
      {children}
    </span>
  );
}

export function AppearanceGroup() {
  const glow = useProcessingGlow();
  const showCost = useShowCost();

  return (
    <>
      <PrefsGroup title="Animations">
        <SwitchRow
          id="processing-glow-switch"
          icon={
            <RowIcon>
              <SparklesIcon />
            </RowIcon>
          }
          title="Glow while responding"
          subtitle="A colorful glow along the bottom of the screen while an agent is working. Applies to this device."
          checked={glow}
          onChange={setProcessingGlowEnabled}
        />
      </PrefsGroup>
      <PrefsGroup title="Usage">
        <SwitchRow
          id="show-cost-switch"
          icon={
            <RowIcon>
              <CircleDollarSignIcon />
            </RowIcon>
          }
          title="Show estimated cost"
          subtitle="Adds the estimated price of each reply next to its token count. An estimate only — subscription plans aren't billed per token. Applies to this device."
          checked={showCost}
          onChange={setShowCostEnabled}
        />
      </PrefsGroup>
    </>
  );
}
