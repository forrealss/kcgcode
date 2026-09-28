/**
 * Headline sambutan homepage — dipilih acak tiap kali halaman dibuka.
 * Logika murni (tanpa DOM) agar dapat diuji `bun test`.
 */

export const HOME_HEADLINES: readonly string[] = [
  "What are we building today?",
  "Ready when you are.",
  "Let's ship something great.",
  "What should we tackle next?",
  "Got a bug? Let's hunt it down.",
  "Describe it, I'll code it.",
  "Pick a project and let's go.",
  "Where were we?",
  "Time to make the code purr.",
  "What's on your mind?",
];

/**
 * Pilih satu headline secara acak. `random` diinjeksi agar deterministik
 * saat diuji (default `Math.random`). List kosong -> string kosong.
 */
export function pickHeadline(
  headlines: readonly string[] = HOME_HEADLINES,
  random: () => number = Math.random,
): string {
  if (headlines.length === 0) return "";
  const index = Math.min(headlines.length - 1, Math.floor(random() * headlines.length));
  return headlines[Math.max(0, index)] ?? "";
}
