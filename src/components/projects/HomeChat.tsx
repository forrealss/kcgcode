/**
 * Chat homepage: headline acak + logo, lalu composer. Di bawah kotak input
 * ada baris polos (tanpa border): pemilih Project di kiri, model di kanan.
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
 */
import {
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderPlusIcon,
  SendHorizontalIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentPicker } from "@/components/sessions/AgentPicker";
import { ModelPicker } from "@/components/sessions/ModelPicker";
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
import { useRouter } from "@/hooks/useRouter";
import { ApiError, apiFetch } from "@/lib/api";
import { pickHeadline } from "@/lib/headlines";
import { setPendingPrompt } from "@/lib/pending-prompt";
import type { ProjectOverview } from "@/lib/project-overview";
import { sessionPath } from "@/lib/routes";
import { seedSession } from "@/lib/session-handoff";
import logo from "@/logo.svg";
import type { Session, SessionModel } from "@/types";

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
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Model & agent untuk Session baru; null = default opencode. */
  const [model, setModel] = useState<SessionModel | null>(null);
  const [agent, setAgent] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Project tersimpan sudah dihapus / belum ada -> pakai yang paling baru aktif.
  const selected =
    overviews.find((o) => o.project.id === projectId)?.project ?? overviews[0]?.project ?? null;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const choose = (id: string) => {
    if (id !== selected?.id) {
      // Model/agent tersedia per Project (config opencode masing-masing).
      setModel(null);
      setAgent(null);
    }
    setProjectId(id);
    if (typeof localStorage !== "undefined") localStorage.setItem(LAST_PROJECT_KEY, id);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const canSend = selected !== null && text.trim() !== "" && !sending;

  const submit = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!canSend || selected === null) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ agentType: "opencode", projectId: selected.id, model, agent }),
      });
      const { session } = (await res.json()) as { session: Session };
      setPendingPrompt(session.id, text);
      // Session view dirender langsung dari data ini (tanpa fetch ulang),
      // lalu composer "berpindah" ke dasar layar lewat View Transition.
      seedSession(session);
      navigate(sessionPath(selected.id, session.id), { transition: "to-session" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to start a new session");
      setSending(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 pb-[10dvh]">
      <div data-vt-name="home-headline" className="flex items-center justify-center gap-3 px-2">
        <img src={logo} alt="" aria-hidden className="size-10 shrink-0 sm:size-12" />
        <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
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
          <InputGroup className="-m-px w-auto rounded-2xl bg-card shadow-sm dark:bg-card">
            <InputGroupTextarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter kirim, Shift+Enter baris baru (abaikan saat komposisi IME).
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={selected ? `Ask anything in ${selected.name}…` : "Pick a project first"}
              aria-label="Message"
              disabled={sending}
              rows={2}
              className="max-h-60 min-h-20 px-4 text-base leading-6 md:text-base"
            />
            <InputGroupAddon align="block-end" className="gap-2 px-2 pb-2">
              {selected && (
                <AgentPicker
                  projectId={selected.id}
                  sessionId={null}
                  agent={agent}
                  onChanged={setAgent}
                  disabled={sending}
                />
              )}
              <InputGroupButton
                type="submit"
                size="icon-sm"
                variant="default"
                className="ml-auto size-9 rounded-full"
                disabled={!canSend}
                aria-label="Send"
              >
                {sending ? <Spinner /> : <SendHorizontalIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>

          {/* Section 2 — konteks Session baru: Project (kiri) & model (kanan),
            tanpa latar (hanya border container luar). */}
          <div className="flex min-w-0 items-center justify-between gap-2 px-1.5 py-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 min-w-0 max-w-[55%] gap-1.5 px-2 font-normal text-muted-foreground hover:text-foreground"
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

            {selected && (
              <div className="flex min-w-0 max-w-[45%] justify-end">
                <ModelPicker
                  projectId={selected.id}
                  sessionId={null}
                  model={model}
                  onChanged={setModel}
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
    </div>
  );
}
