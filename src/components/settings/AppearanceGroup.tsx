/**
 * Settings -> Appearance (`/settings/appearance`):
 *
 * - Glow saat memproses: glow ala Siri di dasar layar Session selama model
 *   merespon (`ProcessingGlow`). Default mati; preferensi per perangkat
 *   (`lib/appearance`).
 * - Estimasi biaya: harga estimasi tiap balasan di samping jumlah tokennya.
 *   Default mati (hanya estimasi; langganan tidak ditagih per token).
 * - Voice input: bahasa dikte suara di composer (`lib/speech`). Default
 *   Bahasa Indonesia; per perangkat.
 */
import { CircleDollarSignIcon, LanguagesIcon, SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";
import { PrefsGroup, SwitchRow } from "@/components/settings/prefs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  setProcessingGlowEnabled,
  setShowCostEnabled,
  useProcessingGlow,
  useShowCost,
} from "@/lib/appearance";
import {
  SPEECH_LANG_OPTIONS,
  type SpeechLangPref,
  setSpeechLangPref,
  speechSupport,
  useSpeechLangPref,
} from "@/lib/speech";

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

/** Keterangan grup Voice input sesuai dukungan browser ini. */
const VOICE_DESCRIPTION: Record<ReturnType<typeof speechSupport>, string> = {
  supported: "Tap the mic in the message box and speak — your message sends when you stop talking.",
  insecure: "Voice input needs a secure connection. Open KCG Code over HTTPS or on localhost.",
  unsupported: "This browser doesn't support voice input. Try Chrome, Edge or Safari.",
};

export function AppearanceGroup() {
  const glow = useProcessingGlow();
  const showCost = useShowCost();
  const lang = useSpeechLangPref();
  const langId = useId();

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

      <PrefsGroup title="Voice input" description={VOICE_DESCRIPTION[speechSupport()]}>
        {/* Label + select ditumpuk di HP, sebaris di layar lebar. */}
        <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <RowIcon>
              <LanguagesIcon />
            </RowIcon>
            <div className="flex min-w-0 flex-col gap-0.5">
              <label htmlFor={langId} className="text-[15px] leading-5">
                Language
              </label>
              <span className="text-[13px] leading-snug text-muted-foreground">
                The language you speak. Applies to this device.
              </span>
            </div>
          </div>
          <Select value={lang} onValueChange={(v) => setSpeechLangPref(v as SpeechLangPref)}>
            <SelectTrigger
              id={langId}
              className="w-full shrink-0 sm:w-44"
              aria-label="Voice input language"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SPEECH_LANG_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </li>
      </PrefsGroup>
    </>
  );
}
