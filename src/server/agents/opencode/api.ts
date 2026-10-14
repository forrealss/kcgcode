/** Subset API `@opencode/client` yang dipakai backend + konektor default ke service. */
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { OPENCODE_MIN_MAJOR } from "./version";

/** Subset API `@opencode/client` yang dipakai (di-mock pada test). */
export interface OpencodeApi {
  server: { info(): Promise<unknown> };
  session: {
    create(input: Record<string, unknown>): Promise<unknown>;
    get(input: { sessionID: string }): Promise<unknown>;
    remove(input: { sessionID: string }): Promise<unknown>;
    switchModel(input: Record<string, unknown>): Promise<unknown>;
    switchAgent(input: Record<string, unknown>): Promise<unknown>;
    prompt(input: Record<string, unknown>): Promise<unknown>;
    command(input: Record<string, unknown>): Promise<unknown>;
    compact(input: Record<string, unknown>): Promise<unknown>;
    interrupt(input: { sessionID: string }): Promise<unknown>;
    instructions: {
      entry: {
        put(input: Record<string, unknown>): Promise<unknown>;
        remove(input: Record<string, unknown>): Promise<unknown>;
      };
    };
    form: {
      reply(input: Record<string, unknown>): Promise<unknown>;
      cancel(input: Record<string, unknown>): Promise<unknown>;
    };
  };
  permission: { reply(input: Record<string, unknown>): Promise<unknown> };
  model: {
    list(input: Record<string, unknown>): Promise<unknown>;
    default(input: Record<string, unknown>): Promise<unknown>;
  };
  provider: { list(input: Record<string, unknown>): Promise<unknown> };
  agent: { list(input: Record<string, unknown>): Promise<unknown> };
  mcp: {
    list(input: Record<string, unknown>): Promise<unknown>;
    connect(input: Record<string, unknown>): Promise<unknown>;
    disconnect(input: Record<string, unknown>): Promise<unknown>;
  };
  skill: { list(input: Record<string, unknown>): Promise<unknown> };
  command: { list(input: Record<string, unknown>): Promise<unknown> };
  file: { find(input: Record<string, unknown>): Promise<unknown> };
  vcs: { status(input: Record<string, unknown>): Promise<unknown> };
  location: { reload(input: Record<string, unknown>): Promise<unknown> };
  event: {
    subscribe(input?: undefined, options?: { signal?: AbortSignal }): AsyncIterable<unknown>;
  };
}

/** Koneksi ke service opencode (di-mock pada test). */
export type OpencodeConnector = () => Promise<OpencodeApi>;

/** Default: temukan/jalankan background service opencode v2 lalu buat client. */
export const defaultConnector: OpencodeConnector = async () => {
  const endpoint = await Service.ensure({
    version: (v: string) => Number.parseInt(v, 10) >= OPENCODE_MIN_MAJOR,
  });
  return OpenCode.make({
    baseUrl: endpoint.url,
    headers: Service.headers(endpoint),
  }) as unknown as OpencodeApi;
};
