/**
 * Chat homepage: headline acak + logo, lalu composer. Di bawah kotak input
 * ada baris polos (tanpa border): pemilih Project di kiri, agent + model di
 * kanan (satu trigger `ModelPicker` — model bergantung pada agent).
 *
 * Tata letak: semuanya di tengah layar. Desktop menampilkan daftar Session
 * terbaru (`HomeRecentSessions`) di bawah composer; di HP daftar itu
 * disembunyikan dan logo ditumpuk di atas headline.
 *
 * Kirim = buat Session baru di Project terpilih (`POST /api/sessions`),
 * titipkan teks sebagai prompt tertunda (`lib/pending-prompt.ts`), lalu
 * pindah ke Session view — `useSessionChat` mengirimnya sekali setelah
 * koneksi WS ter-attach. Project terakhir dipakai diingat di localStorage.
 *
 * Mode agent ada di dalam kotak input, kiri bawah (seperti composer Session).
 * Pemilih model & agent sama dengan Session (`ModelPicker`, `AgentPicker`) —
 * tanpa Session, pilihan dikirim di body `POST /api/sessions`.
 * Keduanya di-reset saat Project berganti karena daftarnya per Project.
 *
 * Dikte suara (`useSpeechToText`): tombol mic di sebelah kirim — ucapan tampil
 * live di input dan Session baru langsung dibuat begitu pengguna diam.
 */
import {
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderPlusIcon,
  SendHorizontalIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HomeBackdrop } from "@/components/projects/HomeBackdrop";
import { HomeRecentSessions } from "@/components/projects/HomeRecentSessions";
import { AgentPicker } from "@/components/sessions/AgentPicker";
import { ComposerSuggestions } from "@/components/sessions/ComposerSuggestions";
import { ModelPicker } from "@/components/sessions/ModelPicker";
import { PermissionModePicker } from "@/components/sessions/PermissionModePicker";
import { SlashCommandDropdown } from "@/components/sessions/SlashCommandDropdown";
import { MicButton, VoiceDictationPill } from "@/components/sessions/VoiceInput";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { usePermissionModes } from "@/hooks/usePermissionModes";
import { useRouter } from "@/hooks/useRouter";
import { useSlashCommands } from "@/hooks/useSlashCommands";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { agentQuery, readPreferredAgentType, storePreferredAgentType } from "@/lib/agent-types";
import { ApiError, apiFetch } from "@/lib/api";
import { notifyDataChanged } from "@/lib/data-events";
import { pickHeadline } from "@/lib/headlines";
import { setPendingPrompt } from "@/lib/pending-prompt";
import type { ProjectOverview } from "@/lib/project-overview";
import { sessionPath } from "@/lib/routes";
import { seedSession } from "@/lib/session-handoff";
import logo from "@/logo.svg";
import type { AgentType, Session, SessionModel } from "@/types";

/**
 * Slot "Mode" composer homepage: permission mode untuk agent yang memilikinya
 * (mis. Claude Code), pemilih agent untuk lainnya (opencode). Kosong selama
 * capability agent belum termuat (hindari kedip).
 */
function HomeModeControl(props: {
  projectId: string;
  agentType: AgentType;
  agent: string | null;
  onAgentChange: (agent: string | null) => void;
  permissionMode: string | null;
  onPermissionModeChange: (mode: string | null) => void;
  disabled: boolean;
}) {
  const picker = usePermissionModes(
    props.projectId,
    props.agentType,
    null,
    props.onPermissionModeChange,
  );
  if (picker.modes === null) return null;
  if (picker.modes.length > 0) {
    return (
      <PermissionModePicker
        picker={picker}
        active={props.permissionMode}
        disabled={props.disabled}
      />
    );
  }
  return (
    <AgentPicker
      projectId={props.projectId}
      agentType={props.agentType}
      sessionId={null}
      agent={props.agent}
      onChanged={props.onAgentChange}
      disabled={props.disabled}
    />
  );
}

const LAST_PROJECT_KEY = "kcg-home-project";

export interface HomeChatProps {
  /** Project terurut aktivitas terbaru (`buildProjectOverviews`). */
  overviews: ProjectOverview[];
  /** Buka dialog pembuatan Project baru. */
  onNewProject: () => void;
}

function readLastProject(): string | null {
  return typeof localStorage === "undefined" ? null : localStorage.getItem(LAST_PROJECT_KEY);
}

export function HomeChat({ overviews, onNewProject }: HomeChatProps) {
  const { navigate } = useRouter();
  // Dipilih sekali per kunjungan — tidak berganti saat re-render.
  const [headline] = useState(() => pickHeadline());
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState<string | null>(readLastProject);
  /** Backend Session baru (OpenCode / Claude Code), diingat per perangkat. */
  const [agentType, setAgentType] = useState<AgentType>(readPreferredAgentType);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Model, thinking effort & agent untuk Session baru; null = default agent. */
  const [model, setModel] = useState<SessionModel | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [agent, setAgent] = useState<string | null>(null);
  /** Permission mode Session baru (agent dengan capability, mis. Claude Code). */
  const [permissionMode, setPermissionMode] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** Kotak input — acuan posisi saran slash command. */
  const inputBoxRef = useRef<HTMLDivElement | null>(null);

  // Project tersimpan sudah dihapus / belum ada -> pakai yang paling baru aktif.
  const selectedOverview =
    overviews.find((o) => o.project.id === projectId) ?? overviews[0] ?? null;
  const selected = selectedOverview?.project ?? null;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  /**
   * Slash command (`/` di awal pesan) — mis. `/init` sebagai pesan pertama
   * Session baru. Daftar milik Project & agent terpilih, dimuat saat `/`
   * pertama diketik.
   */
  const slash = useSlashCommands(
    selected ? `/api/projects/${selected.id}/commands${agentQuery(agentType)}` : null,
  );
  useEffect(
    () =>
      slash.setOnPick((next) => {
        setText(next);
        requestAnimationFrame(() => textareaRef.current?.focus());
      }),
    [slash],
  );

  const choose = (id: string) => {
    if (id !== selected?.id) {
      // Model/agent tersedia per Project (config opencode masing-masing).
      setModel(null);
      setEffort(null);
      setAgent(null);
      setPermissionMode(null);
    }
    setProjectId(id);
    if (typeof localStorage !== "undefined") localStorage.setItem(LAST_PROJECT_KEY, id);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const chooseAgentType = (next: AgentType) => {
    if (next !== agentType) {
      // Model & mode berasal dari backend masing-masing.
      setModel(null);
      setEffort(null);
      setAgent(null);
      setPermissionMode(null);
    }
    setAgentType(next);
    storePreferredAgentType(next);
    // Tanpa fokus ke textarea: dipanggil dari dialog ModelPicker yang masih
    // terbuka (fokus terkunci di dialog sampai ditutup).
  };

  const canSend = selected !== null && text.trim() !== "" && !sending;

  /** `override`: teks final dikte suara (`text` di closure bisa belum memuatnya). */
  const submit = async (event?: React.FormEvent<HTMLFormElement>, override?: string) => {
    event?.preventDefault();
    const prompt = override ?? text;
    if (selected === null || prompt.trim() === "" || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          agentType,
          projectId: selected.id,
          model,
          effort,
          agent,
          permissionMode,
        }),
      });
      const { session } = (await res.json()) as { session: Session };
      setPendingPrompt(session.id, prompt);
      // Session view dirender langsung dari data ini (tanpa fetch ulang),
      // lalu composer "berpindah" ke dasar layar lewat View Transition.
      seedSession(session);
      notifyDataChanged();
      navigate(sessionPath(selected.id, session.id), { transition: "to-session" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to start a new session");
      setSending(false);
    }
  };

  /** Dikte suara: teks live ke input, diam -> langsung buat Session. */
  const dictation = useSpeechToText({
    onText: setText,
    onFinish: (spoken) => {
      setText(spoken);
      void submit(undefined, spoken);
    },
    onError: setError,
  });

  return (
    // `isolate`: stacking context untuk `HomeBackdrop` (-z-10) — tergambar di
    // belakang headline & composer, tapi tetap di atas latar halaman.
    <div className="isolate mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 pb-[10dvh]">
      {/* HP: logo di atas headline (tengah); desktop: berdampingan. */}
      <div
        data-vt-name="home-headline"
        className="flex flex-col items-center justify-center gap-3 px-2 sm:flex-row"
      >
        {/* Dekorasi "blueprint" berpusat di logo. */}
        <span className="relative shrink-0">
          <HomeBackdrop />
          <img src={logo} alt="" aria-hidden className="size-10 sm:size-12" />
        </span>
        <h1 className="text-balance text-center text-2xl font-semibold tracking-tight sm:text-left sm:text-3xl">
          {headline}
        </h1>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        {/* Container luar: hanya border (tanpa latar), membungkus dua section —
            kotak input berlatar di atas, baris Project/model polos di bawah. */}
        {/* `data-vt-name`: selama transisi "to-session" kotak ini dan area
            Session view berbagi nama view-transition -> kotak composer
            MELUAS menjadi halaman Session (container transform). */}
        <div data-vt-name="session-surface" className="flex flex-col rounded-2xl border">
          {/* Section 1 — kotak input: textarea + baris aksi (mode agent kiri,
            kirim kanan), tata letak sama dengan composer Session. `-m-px`
            menumpuk border kotak ini di atas border container luar. */}
          <ComposerSuggestions open={slash.open} anchorRef={inputBoxRef} onDismiss={slash.close}>
            <SlashCommandDropdown
              loading={slash.loading}
              error={slash.error}
              matches={slash.matches}
              highlighted={slash.highlighted}
              onPick={(i) => {
                const next = slash.pick(i);
                if (next === null) return;
                setText(next);
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}
            />
          </ComposerSuggestions>
          <InputGroup
            ref={inputBoxRef}
            className="-m-px w-auto rounded-2xl bg-card shadow-sm dark:bg-card"
          >
            <InputGroupTextarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                slash.onInputChange(
                  e.target.value,
                  e.target.selectionStart ?? e.target.value.length,
                );
              }}
              onBlur={() => slash.close()}
              onKeyDown={(e) => {
                // Dropdown slash command aktif: panah/enter/tab/escape miliknya.
                if (slash.handleKeyDown(e)) return;
                // Enter kirim, Shift+Enter baris baru (abaikan saat komposisi IME).
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={
                dictation.listening
                  ? "Listening…"
                  : selected
                    ? `Ask anything in ${selected.name}…`
                    : "Pick a project first"
              }
              aria-label="Message"
              disabled={sending}
              // Selama dikte isinya milik pengenal suara.
              readOnly={dictation.listening}
              rows={2}
              className="max-h-60 min-h-20 px-4 text-base leading-6 md:text-base"
            />
            <InputGroupAddon align="block-end" className="gap-2 px-2 pb-2">
              {selected && (
                <HomeModeControl
                  projectId={selected.id}
                  agentType={agentType}
                  agent={agent}
                  onAgentChange={setAgent}
                  permissionMode={permissionMode}
                  onPermissionModeChange={setPermissionMode}
                  disabled={sending}
                />
              )}
              {/* Mic + kirim di kanan; selama dikte pil (✕ / bar / ✓)
                  menggantikan keduanya. */}
              <div className="ml-auto flex items-center gap-1">
                {dictation.listening ? (
                  <VoiceDictationPill
                    analyser={dictation.analyser}
                    activity={dictation.voiceActivity}
                    onCancel={dictation.cancel}
                    onFinish={dictation.finish}
                  />
                ) : (
                  <>
                    <MicButton
                      support={dictation.support}
                      disabled={selected === null || sending}
                      onClick={() => dictation.start(text)}
                      className="rounded-full"
                    />
                    <InputGroupButton
                      type="submit"
                      size="icon-sm"
                      variant="default"
                      className="size-9 rounded-full"
                      disabled={!canSend}
                      aria-label="Send"
                    >
                      {sending ? <Spinner /> : <SendHorizontalIcon />}
                    </InputGroupButton>
                  </>
                )}
              </div>
            </InputGroupAddon>
          </InputGroup>

          {/* Section 2 — konteks Session baru: Project (kiri) & agent + model
            (kanan), tanpa latar (hanya border container luar). */}
          <div className="flex min-w-0 items-center justify-between gap-2 px-1.5 py-1">
            <div className="flex min-w-0 items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 min-w-0 gap-1.5 px-2 font-normal text-muted-foreground hover:text-foreground"
                    aria-label={`Project: ${selected?.name ?? "none"}. Change project`}
                    disabled={sending}
                  >
                    <FolderIcon data-icon="inline-start" />
                    <span className="truncate">{selected?.name ?? "Select project"}</span>
                    <ChevronDownIcon data-icon="inline-end" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 w-64">
                  <DropdownMenuLabel>Project</DropdownMenuLabel>
                  <DropdownMenuGroup>
                    {overviews.map(({ project }) => (
                      <DropdownMenuItem key={project.id} onSelect={() => choose(project.id)}>
                        <FolderIcon />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{project.name}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {project.path}
                          </span>
                        </span>
                        {project.id === selected?.id && <CheckIcon />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={onNewProject}>
                      <FolderPlusIcon />
                      New project
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {selected && (
              <div className="flex max-w-[60%] shrink-0 justify-end">
                {/* Agent dipilih di dialog yang sama dengan model; trigger
                    menampilkan logo agent + nama model. */}
                <ModelPicker
                  projectId={selected.id}
                  agentType={agentType}
                  sessionId={null}
                  model={model}
                  onChanged={setModel}
                  effort={effort}
                  onEffortChange={setEffort}
                  onAgentTypeChange={chooseAgentType}
                  variant="inline"
                />
              </div>
            )}
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </form>

      {selectedOverview && (
        <HomeRecentSessions overview={selectedOverview} className="hidden sm:mt-6 sm:flex" />
      )}
    </div>
  );
}
