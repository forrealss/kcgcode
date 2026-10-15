/** Efek samping OS untuk aksi dashboard (clipboard, browser). */

/** Salin teks ke clipboard (OSC 52 — didukung sebagian besar terminal modern). */
export function copyToClipboard(text: string): void {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  process.stdout.write(`\u001b]52;c;${b64}\u0007`);
}

/** Coba buka URL di browser default OS. */
export async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let cmd: string[];
  if (platform === "win32") {
    cmd = ["cmd", "/c", "start", "", url];
  } else if (platform === "darwin") {
    cmd = ["open", url];
  } else {
    cmd = ["xdg-open", url];
  }
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", windowsHide: true });
  } catch {
    // diam — user bisa buka manual
  }
}
