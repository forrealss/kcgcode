/**
 * Perutean event opencode: satu langganan untuk semua Project, tiap event
 * diterjemahkan lalu dikirim ke listener direktori Session-nya. Task list
 * dirakit dari tool `todowrite` (opencode v2 tidak punya endpoint todo).
 */
import type { TodoItem } from "../../../types";
import { todosFromInput } from "../todos";
import type { AgentEvent } from "../types";
import { translateOpencodeEvent } from "./translate";
import type { OpencodeUsage } from "./usage";
import { directoryKey } from "./util";

/** Nama tool task list opencode. */
const TODO_TOOL = "todowrite";

export class OpencodeEvents {
  /** Listener event per kunci direktori. */
  private readonly listeners = new Map<string, Set<(ev: AgentEvent) => void>>();
  /** Session opencode -> kunci direktori (untuk event tanpa `location`). */
  private readonly sessionDirs = new Map<string, string>();
  /** Task list terakhir per Session opencode. */
  private readonly todos = new Map<string, TodoItem[]>();
  /** Tool call `todowrite` yang sedang berjalan. */
  private readonly todoCalls = new Set<string>();

  constructor(private readonly usage: OpencodeUsage) {}

  /** Session opencode milik direktori ini (rute event-nya). */
  bindSession(sessionID: string, dirKey: string): void {
    this.sessionDirs.set(sessionID, dirKey);
  }

  todosOf(sessionID: string): TodoItem[] {
    return this.todos.get(sessionID) ?? [];
  }

  forgetTodos(sessionID: string): void {
    this.todos.delete(sessionID);
  }

  subscribe(dirKey: string, cb: (ev: AgentEvent) => void): () => void {
    let set = this.listeners.get(dirKey);
    if (!set) {
      set = new Set();
      this.listeners.set(dirKey, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  }

  dispatch(raw: unknown): void {
    const ev = translateOpencodeEvent(raw);
    if (!ev) return;
    const sessionID =
      ev.type === "form.created"
        ? ev.data.form.sessionID
        : (ev.data as { sessionID: string }).sessionID;
    if (ev.location) this.sessionDirs.set(sessionID, directoryKey(ev.location.directory));
    const dirKey = this.sessionDirs.get(sessionID);
    if (!dirKey) return; // Session milik aplikasi opencode lain / belum dikenal.
    this.usage.track(ev);
    this.emit(dirKey, ev);
    // Task list opencode tidak punya endpoint v2: rakit dari tool `todowrite`.
    if (ev.type === "session.tool.input.started" && ev.data.name === TODO_TOOL) {
      this.todoCalls.add(ev.data.id);
    } else if (ev.type === "session.tool.called" && this.todoCalls.has(ev.data.id)) {
      this.todoCalls.delete(ev.data.id);
      const items = todosFromInput(ev.data.input);
      if (items) {
        this.todos.set(sessionID, items);
        this.emit(dirKey, { type: "agent.todos.updated", data: { sessionID, todos: items } });
      }
    }
  }

  private emit(dirKey: string, ev: AgentEvent): void {
    for (const cb of this.listeners.get(dirKey) ?? []) {
      try {
        cb(ev);
      } catch (e) {
        console.warn("[kcg-code] handler event opencode gagal:", e);
      }
    }
  }
}
