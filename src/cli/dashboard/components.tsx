/** Komponen Ink kecil penyusun dashboard (card, baris info, panel). */
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { renderUnicodeCompact } from "uqr";
import { isUpdateInstalled, type UpdateInfo } from "../../server/services/update-check";
import { logoLines } from "../theme";
import type { DashboardSnapshot } from "./snapshot";

/** Lebar kolom label di card status. */
const LABEL_W = 8;

function Card({
  title,
  badge,
  badgeColor = "green",
  width,
  children,
}: {
  title: string;
  badge?: string;
  badgeColor?: string;
  width?: number;
  children: ReactNode;
}) {
  return (
    <Box
      width={width}
      borderStyle="round"
      borderColor="gray"
      flexDirection="column"
      paddingX={2}
      paddingY={0}
    >
      <Box justifyContent="space-between" marginBottom={0}>
        <Text color="cyan" bold>
          {title}
        </Text>
        {badge && (
          <Text color={badgeColor} bold>
            {badge}
          </Text>
        )}
      </Box>
      <Box flexDirection="column" gap={0}>
        {children}
      </Box>
    </Box>
  );
}

export function Brand({ version, compact }: { version: string; compact?: boolean }) {
  const logos = logoLines();
  if (compact) {
    return (
      <Box gap={1}>
        <Box flexShrink={0} gap={1}>
          <Text bold color="cyan">
            ▍kcgcode
          </Text>
          <Text color="cyan">v{version}</Text>
        </Box>
        <Text dimColor wrap="truncate-end">
          · mobile control for CLI agents
        </Text>
      </Box>
    );
  }
  return (
    <Box gap={3} alignItems="center">
      <Box flexDirection="column">
        {logos.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static logo lines
          <Text key={i} color="cyan" bold>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" gap={0}>
        <Box gap={1} alignItems="baseline">
          <Text bold color="white">
            kcgcode
          </Text>
          <Text color="cyan" bold>
            v{version}
          </Text>
        </Box>
        <Text dimColor>mobile control for CLI agents</Text>
        <Text dimColor>opencode · claude code</Text>
      </Box>
    </Box>
  );
}

const TUNNEL_COLOR: Record<string, string> = {
  online: "green",
  connecting: "yellow",
  starting: "yellow",
  reconnecting: "yellow",
  error: "red",
};

/** Rincian kedua tunnel — dibuka lewat menu (t). */
export function TunnelDetailCard({
  detail,
  width,
}: {
  detail: DashboardSnapshot["tunnelDetail"];
  width?: number;
}) {
  const { provider, kcg, lhr } = detail;
  return (
    <Card title="TUNNEL DETAIL" badge={provider ?? "—"} badgeColor="cyan" width={width}>
      <InfoRow label="kcg phase" width={10}>
        <Text color={TUNNEL_COLOR[kcg.phase] ?? "white"}>{kcg.phase}</Text>
      </InfoRow>
      <InfoRow label="kcg url" width={10}>
        <Text color={kcg.url ? "cyan" : "gray"}>{kcg.url ?? "—"}</Text>
      </InfoRow>
      {lhr ? (
        <>
          <InfoRow label="lhr phase" width={10}>
            <Text color={TUNNEL_COLOR[lhr.phase] ?? "white"}>{lhr.phase}</Text>
          </InfoRow>
          <InfoRow label="lhr url" width={10}>
            <Text color={lhr.url ? "cyan" : "gray"}>{lhr.url ?? "—"}</Text>
          </InfoRow>
        </>
      ) : (
        <InfoRow label="lhr" width={10}>
          <Text dimColor>tidak tersedia</Text>
        </InfoRow>
      )}
      <Box marginTop={0}>
        <Text dimColor>Ganti provider di Settings → Remote access.</Text>
      </Box>
    </Card>
  );
}

/**
 * Versi baru di npm. Dashboard yang memantau daemon bisa berasal dari paket
 * yang sudah diperbarui (`installed`) sementara daemon masih versi lama —
 * cukup restart, tidak perlu install lagi.
 */
export function UpdateRow({ update, installed }: { update: UpdateInfo; installed: string }) {
  const pendingRestart = isUpdateInstalled(update, installed);
  return (
    <InfoRow label="Update">
      <Text color={pendingRestart ? "green" : "yellow"} bold>
        v{update.latest}
      </Text>
      {pendingRestart ? (
        <Text dimColor wrap="truncate-end">
          installed · restart to apply
        </Text>
      ) : (
        <>
          <Text dimColor>available ·</Text>
          <Text color="cyan" wrap="truncate-end">
            {update.command}
          </Text>
        </>
      )}
    </InfoRow>
  );
}

/** Form ganti port: input angka, validasi, dan peringatan session running. */
export function PortCard({
  value,
  error,
  current,
  running,
  busy,
  width,
}: {
  value: string;
  error: string | null;
  current: number;
  running: number;
  busy: boolean;
  width: number;
}) {
  return (
    <Card title="CHANGE PORT" badge={`current ${current}`} badgeColor="cyan" width={width}>
      <Box marginTop={1} gap={1}>
        <Text dimColor>New port</Text>
        <Text color="cyan" bold>
          ›
        </Text>
        <Text color="white" bold>
          {value}
        </Text>
        {!busy && <Text color="cyan">▌</Text>}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {busy ? (
          <Text color="yellow">Restarting server…</Text>
        ) : error ? (
          <Text color="red">✗ {error}</Text>
        ) : (
          <Text dimColor>Saved to config · server restarts on the new port.</Text>
        )}
        {running > 0 && !busy && (
          <Text color="yellow">
            ! {running} running session{running === 1 ? "" : "s"} will be interrupted.
          </Text>
        )}
      </Box>
    </Card>
  );
}

/** Baris label (rata kiri, lebar tetap) + nilai. */
export function InfoRow({
  label,
  width = LABEL_W,
  children,
}: {
  label: string;
  width?: number;
  children: ReactNode;
}) {
  return (
    <Box gap={1}>
      <Box flexShrink={0} width={width}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexShrink={1} gap={1}>
        {children}
      </Box>
    </Box>
  );
}

/** QR code untuk membuka dashboard dari HP. */
export function QrCard({
  target,
  width,
}: {
  target: { label: string; url: string };
  width: number;
}) {
  const qr = renderUnicodeCompact(target.url, { border: 1 });
  return (
    <Card title="OPEN ON PHONE" badge={target.label} badgeColor="cyan" width={width}>
      <Box flexDirection="column" alignItems="center">
        <Text>{qr}</Text>
        <Text color="cyan">{target.url}</Text>
      </Box>
    </Card>
  );
}
