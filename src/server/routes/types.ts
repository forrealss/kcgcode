/**
 * Tipe bersama tabel rute API (pola `routes/types.ts` kcgcode).
 *
 * Composition root (`app.ts`) merakit service lalu menyuntikkannya ke tiap
 * tabel rute via `ApiRouteContext`; handler tidak lagi menutup dependency
 * secara langsung seperti saat semuanya menumpuk di `app.ts`.
 */
import type { AttachmentManager } from "../services/attachments";
import type { ProjectManager } from "../services/project-manager";
import type { SessionManager } from "../services/session-manager";

/** Pembungkus handler yang menolak request tidak terotentikasi (Req 9.2/9.3). */
export type ApiGuard = <Req extends Request, Res extends Response>(
  handler: (req: Req) => Res | Promise<Res>,
) => (req: Req) => Response | Promise<Response>;

export interface ApiRouteContext {
  projectManager: ProjectManager;
  sessionManager: SessionManager;
  attachments: AttachmentManager;
  guard: ApiGuard;
}
