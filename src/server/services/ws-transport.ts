/**
 * Transport WebSocket — adaptor koneksi + dispatch pesan Client -> Gateway.
 *
 * Dipisah dari `websocket-gateway.ts` (yang mengurus registrasi & broadcast)
 * agar tiap berkas satu tanggung jawab:
 * - `bunWsSubscriber` menyamarkan `ServerWebSocket` Bun menjadi `Subscriber`.
 * - `dispatchClientMessage` mem-parsing teks JSON dari Client lalu meneruskan
 *   ke gateway sesuai `type` (attach/input/prompt_response/stop/interrupt).
 */
import type { ServerWebSocket } from "bun";
import type { PromptResponse } from "../../types";
import type { Subscriber, WebSocketGateway } from "./websocket-gateway";

/** Adaptor ServerWebSocket Bun ke `Subscriber` (untuk wiring di `app.ts`). */
export function bunWsSubscriber<T>(ws: ServerWebSocket<T>): Subscriber {
  return {
    send(msg) {
      ws.send(JSON.stringify(msg));
    },
    close() {
      ws.close(1000);
    },
  };
}

function isPromptResponse(r: unknown): r is PromptResponse {
  return (
    r === "approve" ||
    r === "always" ||
    r === "deny" ||
    r === "cancel" ||
    (typeof r === "object" && r !== null && typeof (r as { option?: unknown }).option === "string")
  );
}

function invalidMessage(sub: Subscriber, detail: string): void {
  sub.send({ type: "error", code: "INVALID_MESSAGE", message: detail });
}

/**
 * Mem-parsing pesan Client dan meneruskan ke gateway sesuai `type`.
 * Pesan JSON rusak / payload salah bentuk -> `error` INVALID_MESSAGE.
 */
export function dispatchClientMessage(
  gateway: WebSocketGateway,
  sub: Subscriber,
  raw: string,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalidMessage(sub, "Pesan JSON tidak valid");
    return;
  }
  if (typeof parsed !== "object" || parsed === null) {
    invalidMessage(sub, "Pesan harus berupa objek JSON");
    return;
  }
  const msg = parsed as Record<string, unknown>;
  switch (msg.type) {
    case "attach":
      if (typeof msg.sessionId === "string") gateway.attach(sub, msg.sessionId);
      else invalidMessage(sub, "attach membutuhkan sessionId string");
      break;
    case "input":
      if (
        typeof msg.sessionId === "string" &&
        typeof msg.text === "string" &&
        (msg.files === undefined ||
          (Array.isArray(msg.files) && msg.files.every((f) => typeof f === "string"))) &&
        (msg.images === undefined ||
          (Array.isArray(msg.images) && msg.images.every((f) => typeof f === "string")))
      ) {
        gateway.input(sub, msg.sessionId, msg.text, msg.files, msg.images);
      } else {
        invalidMessage(sub, "input membutuhkan sessionId dan text string");
      }
      break;
    case "prompt_response":
      if (
        typeof msg.sessionId === "string" &&
        typeof msg.promptId === "string" &&
        isPromptResponse(msg.response)
      ) {
        gateway.promptResponse(sub, msg.sessionId, msg.promptId, msg.response);
      } else {
        invalidMessage(sub, "prompt_response membutuhkan sessionId, promptId, dan response valid");
      }
      break;
    case "stop":
      if (typeof msg.sessionId === "string") {
        gateway.stop(sub, msg.sessionId);
      } else {
        invalidMessage(sub, "stop membutuhkan sessionId string");
      }
      break;
    case "interrupt":
      if (typeof msg.sessionId === "string") {
        gateway.interrupt(sub, msg.sessionId);
      } else {
        invalidMessage(sub, "interrupt membutuhkan sessionId string");
      }
      break;
    default:
      sub.send({
        type: "error",
        code: "UNKNOWN_MESSAGE_TYPE",
        message: "Tipe pesan tidak dikenal",
      });
  }
}
