/** Frame dashboard (presentasional murni): status server, panel, menu. */
import { Box, renderToString, Text } from "ink";
import { Brand, InfoRow, PortCard, QrCard, TunnelDetailCard, UpdateRow } from "./components";
import { CONFIRM_TEXT, type DashboardViewState, menuHint, menuItems } from "./menu";
import { type DashboardInfo, type DashboardSnapshot, formatUptime, takeSnapshot } from "./snapshot";

const PAD = 2;
const COMPACT_BELOW = 64;

interface DashboardUIProps {
  snap: DashboardSnapshot;
  version: string;
  view?: DashboardViewState;
}

export function DashboardUI({ snap, version, view = {} }: DashboardUIProps) {
  const background = snap.mode === "background";
  const items = menuItems(view, snap.mode);
  const menuIndex = Math.min(Math.max(view.menuIndex ?? 0, 0), items.length - 1);
  const { running, target } = snap;

  const terminalWidth = process.stdout.columns ?? 72;
  const cardWidth = Math.min(68, Math.max(36, terminalWidth - 4));
  const compact = terminalWidth < COMPACT_BELOW;
  const uptime = formatUptime(Date.now() - snap.startedAt);
  const labelWidth = Math.max(...items.map((i) => i.label.length));
  const panelOpen = Boolean(view.showQr || view.showDetail);
  const editingPort = view.portInput != null;
  const quitHint = background ? "q close" : "q quit";

  return (
    // Wrapper selebar terminal agar blok konten berada di tengah secara horizontal
    <Box width={terminalWidth} flexDirection="column" alignItems="center">
      <Box flexDirection="column" paddingX={PAD} paddingY={1} gap={1} width={cardWidth + PAD * 2}>
        {/* Dekorasi KCG tetap di atas */}
        <Brand version={version} compact={compact} />

        {/* Status server: header Running + uptime, lalu URL & info proses */}
        <Box
          width={cardWidth}
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={2}
          paddingY={0}
        >
          <Box justifyContent="space-between" marginBottom={1}>
            {snap.restarting ? (
              <Text color="yellow" bold>
                ◌ {snap.busyLabel ?? "Restarting…"}
              </Text>
            ) : (
              <Text color="green" bold>
                ● Running{background ? " in background" : ""}
              </Text>
            )}
            <Text dimColor>up {uptime}</Text>
          </Box>
          <InfoRow label="Local">
            <Text color="cyan">{snap.localUrl}</Text>
            {snap.portNote && <Text color="yellow">({snap.portNote})</Text>}
          </InfoRow>
          {snap.networkUrl && (
            <InfoRow label="Network">
              <Text color="cyan">{snap.networkUrl}</Text>
            </InfoRow>
          )}
          {snap.publicUrl && (
            <InfoRow label="Public">
              <Text color="cyan" bold>
                {snap.publicUrl}
              </Text>
            </InfoRow>
          )}
          <InfoRow label="Tunnel">
            <Text color={snap.tunnel.color}>{snap.tunnel.text}</Text>
          </InfoRow>
          {snap.pairingUri && (
            <InfoRow label="Pair at">
              <Text color="yellow">{snap.pairingUri}</Text>
            </InfoRow>
          )}
          {snap.keepAwake && (
            <InfoRow label="Awake">
              <Text color={snap.keepAwake.active ? "green" : "yellow"} wrap="truncate-end">
                {snap.keepAwake.text}
              </Text>
            </InfoRow>
          )}
          <InfoRow label="Sessions">
            <Text color="white">{snap.sessions}</Text>
            <Text dimColor>·</Text>
            <Text color={running > 0 ? "green" : "white"}>{running} running</Text>
            <Text dimColor>·</Text>
            <Text color="white">
              {snap.projects} {snap.projects === 1 ? "project" : "projects"}
            </Text>
          </InfoRow>
          <InfoRow label="Process">
            <Text color="white">PID {snap.pid}</Text>
            <Text dimColor>·</Text>
            <Text color="white">{snap.memory}</Text>
          </InfoRow>
          {snap.update && <UpdateRow update={snap.update} installed={version} />}
        </Box>

        {view.showQr && <QrCard target={target} width={cardWidth} />}
        {view.showDetail && <TunnelDetailCard detail={snap.tunnelDetail} width={cardWidth} />}
        {editingPort && (
          <PortCard
            value={view.portInput ?? ""}
            error={view.portError ?? null}
            current={snap.port}
            running={running}
            busy={snap.restarting}
            width={cardWidth}
          />
        )}

        {/* Menu: tombol shortcut + label rata kolom + hint terpotong rapi */}
        <Box
          width={cardWidth}
          borderStyle="round"
          borderColor="gray"
          flexDirection="column"
          paddingX={1}
          paddingY={0}
        >
          {items.map((item, idx) => {
            const hint = menuHint(item.id, snap);
            const selected = idx === menuIndex;
            return (
              <Box key={item.id} paddingX={1} backgroundColor={selected ? "blue" : undefined}>
                <Box flexShrink={0}>
                  <Text color={selected ? "white" : "cyan"} bold>
                    {selected ? "▶ " : "  "}
                    {item.key}
                    {"  "}
                  </Text>
                  <Text color="white" bold={selected}>
                    {item.label.padEnd(labelWidth + 2)}
                  </Text>
                </Box>
                <Box flexShrink={1}>
                  <Text color={selected ? "white" : "gray"} wrap="truncate-end">
                    {hint}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>

        <Box justifyContent="center" paddingX={1}>
          <Text dimColor wrap="truncate-end">
            {editingPort
              ? "type a port · ⏎ save & restart · esc cancel"
              : compact
                ? `↑↓ move · ⏎ select · ${quitHint}`
                : `↑↓ move · ⏎ select · letter = shortcut${panelOpen ? " · esc close" : ""} · ${quitHint}`}
          </Text>
        </Box>
        <Box justifyContent="center" height={1}>
          {view.confirm ? (
            <Text color="yellow" bold>
              {CONFIRM_TEXT[view.confirm](running)}
            </Text>
          ) : view.flash ? (
            <Text color="green">✓ {view.flash}</Text>
          ) : (
            <Text dimColor> </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/** Frame string (non-TTY / test). */
export function renderDashboard(
  info: DashboardInfo,
  version: string,
  view: DashboardViewState = {},
): string {
  return renderSnapshot(takeSnapshot(info), version, view);
}

export function renderSnapshot(
  snap: DashboardSnapshot,
  version: string,
  view: DashboardViewState = {},
): string {
  return renderToString(<DashboardUI snap={snap} version={version} view={view} />);
}
