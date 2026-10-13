/**
 * Layar setup saat `kcgcode` dijalankan tanpa config yang valid (mis. fresh
 * install sebelum `kcgcode init`). Ditengahkan vertikal & horizontal di
 * alternate screen, dengan tombol untuk langsung menjalankan init.
 */
import { homedir } from "node:os";
import { Box, render, renderToString, Text, useInput, useWindowSize } from "ink";
import type { ReactNode } from "react";
import { Brand } from "./dashboard";
import { InkReact } from "./ink-react";
import { readPackageVersion } from "./theme";

// Hook wajib dari instance React milik Ink — lihat ink-react.ts.
const { useState } = InkReact;

const COMPACT_BELOW = 64;
const LABEL_W = 8;

export type SetupState =
  /** Config belum ada — tawarkan init. */
  | { kind: "missing"; configPath: string }
  /** Config ada tapi tidak bisa dipakai — init tidak akan menimpanya. */
  | { kind: "invalid"; configPath: string; error: string }
  /** Init gagal (mis. permission). */
  | { kind: "failed"; configPath: string; error: string }
  /** Init sukses — siap start. */
  | { kind: "ready"; configPath: string; sandboxPath: string; dataDir: string };

export type SetupOutcome = "start" | "quit";

export interface SetupButton {
  id: "init" | "start" | "quit";
  key: string;
  label: string;
}

export function setupButtons(state: SetupState): SetupButton[] {
  const quit: SetupButton = { id: "quit", key: "q", label: "Quit" };
  if (state.kind === "missing") return [{ id: "init", key: "i", label: "Run kcgcode init" }, quit];
  if (state.kind === "ready") return [{ id: "start", key: "s", label: "Start kcgcode" }, quit];
  return [quit];
}

/** `/home/me/.kcgcode/x` → `~/.kcgcode/x` agar muat di card. */
export function tildify(p: string, home = homedir()): string {
  return home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box gap={1}>
      <Box flexShrink={0} width={LABEL_W}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexShrink={1}>{children}</Box>
    </Box>
  );
}

const ACCENT: Record<SetupState["kind"], string> = {
  missing: "yellow",
  invalid: "red",
  failed: "red",
  ready: "green",
};

function StatusCard({ state, width }: { state: SetupState; width: number }) {
  const color = ACCENT[state.kind];
  const path = <Text color="white">{tildify(state.configPath)}</Text>;
  return (
    <Box
      width={width}
      borderStyle="round"
      borderColor={color}
      flexDirection="column"
      paddingX={2}
      paddingY={0}
    >
      {state.kind === "missing" && (
        <>
          <Box justifyContent="space-between" marginBottom={1}>
            <Text color={color} bold>
              ! Not set up yet
            </Text>
            <Text dimColor>first run</Text>
          </Box>
          <Text>kcgcode needs a config file before it can start.</Text>
          <Box marginY={1}>
            <Row label="Config">
              {path}
              <Text dimColor> (not found)</Text>
            </Row>
          </Box>
          <Text dimColor>
            Init creates the config, a sandbox folder for your projects and a local data folder.
          </Text>
        </>
      )}
      {(state.kind === "invalid" || state.kind === "failed") && (
        <>
          <Box marginBottom={1}>
            <Text color={color} bold>
              ✗ {state.kind === "invalid" ? "Config can't be loaded" : "Init failed"}
            </Text>
          </Box>
          <Text color="white">{state.error.replace(/^\[config\]\s*/, "")}</Text>
          <Box marginY={1}>
            <Row label="Config">{path}</Row>
          </Box>
          <Text dimColor>
            {state.kind === "invalid"
              ? "Fix the file above, then run kcgcode again."
              : "Check the folder permissions, then run kcgcode again."}
          </Text>
        </>
      )}
      {state.kind === "ready" && (
        <>
          <Box justifyContent="space-between" marginBottom={1}>
            <Text color={color} bold>
              ✓ kcgcode is ready
            </Text>
            <Text dimColor>initialized</Text>
          </Box>
          <Row label="Config">{path}</Row>
          <Row label="Sandbox">
            <Text color="white">{tildify(state.sandboxPath)}</Text>
          </Row>
          <Row label="Data">
            <Text dimColor>{tildify(state.dataDir)}</Text>
          </Row>
          <Box marginTop={1}>
            <Text dimColor>Change sandboxRoot in the config anytime.</Text>
          </Box>
        </>
      )}
    </Box>
  );
}

interface SetupUIProps {
  state: SetupState;
  version: string;
  selected?: number;
  columns: number;
  rows: number;
}

function SetupUI({ state, version, selected = 0, columns, rows }: SetupUIProps) {
  const buttons = setupButtons(state);
  const active = Math.min(Math.max(selected, 0), buttons.length - 1);
  const cardWidth = Math.min(64, Math.max(36, columns - 4));
  const compact = columns < COMPACT_BELOW;

  return (
    // Selebar & setinggi terminal → konten berada tepat di tengah layar.
    <Box
      width={columns}
      minHeight={rows}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      <Box flexDirection="column" alignItems="center" gap={1} width={cardWidth}>
        <Brand version={version} compact={compact} />
        <StatusCard state={state} width={cardWidth} />

        <Box gap={2} justifyContent="center" flexWrap="wrap">
          {buttons.map((b, i) => {
            const isActive = i === active;
            return (
              <Box
                key={b.id}
                borderStyle="round"
                borderColor={isActive ? "cyan" : "gray"}
                paddingX={1}
              >
                <Text color="cyan" bold>
                  {isActive ? "▶ " : "  "}
                  {b.key}
                  {"  "}
                </Text>
                <Text color="white" bold={isActive}>
                  {b.label}
                </Text>
              </Box>
            );
          })}
        </Box>

        <Text dimColor wrap="truncate-end">
          {buttons.length > 1 ? "←→ move · ⏎ select · letter = shortcut" : "⏎ or q to quit"}
        </Text>
      </Box>
    </Box>
  );
}

/** Frame string (test / non-TTY). */
export function renderSetup(
  state: SetupState,
  version: string,
  opts: { selected?: number; columns?: number; rows?: number } = {},
): string {
  const { selected, columns = 80, rows = 0 } = opts;
  return renderToString(
    <SetupUI state={state} version={version} selected={selected} columns={columns} rows={rows} />,
    { columns },
  );
}

interface SetupAppProps {
  initial: SetupState;
  version: string;
  onInit: () => SetupState;
  onDone: (outcome: SetupOutcome) => void;
}

function SetupApp({ initial, version, onInit, onDone }: SetupAppProps) {
  const { columns, rows } = useWindowSize();
  const [state, setState] = useState<SetupState>(initial);
  const [selected, setSelected] = useState(0);
  const buttons = setupButtons(state);

  const activate = (button: SetupButton | undefined) => {
    if (!button) return;
    if (button.id === "init") {
      setState(onInit());
      setSelected(0);
    } else {
      onDone(button.id);
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") return onDone("quit");
    if (key.escape) return onDone("quit");
    const count = buttons.length;
    if (key.leftArrow || key.upArrow || (key.tab && key.shift)) {
      setSelected((i) => (i + count - 1) % count);
    } else if (key.rightArrow || key.downArrow || key.tab) {
      setSelected((i) => (i + 1) % count);
    } else if (key.return) {
      activate(buttons[selected]);
    } else {
      activate(buttons.find((b) => b.key === input.toLowerCase()));
    }
  });

  return (
    <SetupUI state={state} version={version} selected={selected} columns={columns} rows={rows} />
  );
}

/**
 * Tampilkan layar setup interaktif. Resolve "start" bila user menjalankan
 * init lalu memilih start, "quit" bila keluar. Hanya untuk TTY.
 */
export async function runSetup(
  initial: SetupState,
  onInit: () => SetupState,
): Promise<SetupOutcome> {
  const version = await readPackageVersion();
  return new Promise<SetupOutcome>((resolve) => {
    let done = false;
    const instance = render(
      <SetupApp
        initial={initial}
        version={version}
        onInit={onInit}
        onDone={(outcome) => {
          if (done) return;
          done = true;
          instance.unmount();
          resolve(outcome);
        }}
      />,
      { alternateScreen: true, exitOnCtrlC: false },
    );
  });
}
