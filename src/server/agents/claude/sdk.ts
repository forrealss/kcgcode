/**
 * Batas antara adapter dan Claude Agent SDK: subset `Query` yang dipakai,
 * akses transcript, dan antrean streaming input. Semuanya bisa di-mock pada
 * test.
 */
import type {
  EffortLevel,
  McpServerStatus,
  ModelInfo,
  Options,
  PermissionMode,
  SDKControlGetContextUsageResponse,
  SDKMessage,
  SDKUserMessage,
  SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import {
  deleteSession as sdkDeleteSession,
  getSessionInfo as sdkGetSessionInfo,
  query as sdkQuery,
} from "@anthropic-ai/claude-agent-sdk";

/** Subset `Query` SDK yang dipakai (di-mock pada test). */
export interface ClaudeQueryLike extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  setModel(model?: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  /** Lapisan flag settings (dipakai untuk `effortLevel`; `null` = default model). */
  applyFlagSettings(settings: { effortLevel?: EffortLevel | null }): Promise<void>;
  supportedModels(): Promise<ModelInfo[]>;
  supportedCommands(): Promise<SlashCommand[]>;
  getContextUsage(opts?: {
    detail?: "summary" | "full";
  }): Promise<SDKControlGetContextUsageResponse>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
  /** Nyalakan/matikan server; CLI menyimpannya di config Project (`disabledMcpServers`). */
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>;
  reconnectMcpServer(serverName: string): Promise<void>;
  reloadSkills(): Promise<unknown>;
  close(): void;
}

export type ClaudeQueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => ClaudeQueryLike;

export const defaultQuery: ClaudeQueryFn = (params) =>
  sdkQuery(params) as unknown as ClaudeQueryLike;

/** Akses transcript Session di `~/.claude/projects` (di-mock pada test). */
export interface ClaudeTranscripts {
  exists(sessionId: string, dir: string): Promise<boolean>;
  remove(sessionId: string, dir: string): Promise<void>;
}

export const defaultTranscripts: ClaudeTranscripts = {
  async exists(sessionId, dir) {
    try {
      return (await sdkGetSessionInfo(sessionId, { dir })) !== undefined;
    } catch {
      return false;
    }
  },
  async remove(sessionId, dir) {
    await sdkDeleteSession(sessionId, { dir });
  },
};

/** Antrean pesan user untuk streaming input `query()`. */
export class InputQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private waiter: ((r: IteratorResult<T>) => void) | null = null;
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiter;
    if (waiter) {
      this.waiter = null;
      waiter({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  close(): void {
    this.closed = true;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
    };
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
