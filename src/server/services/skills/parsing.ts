/**
 * Parsing murni respons API skills.sh (`/api/search` & audit). Entri yang
 * tidak valid / tidak aman dibuang di sini sehingga lapisan atas cukup
 * mempercayai hasilnya.
 */
import type { AuditStatus, RegistrySkill, SkillAudit, SkillAuditEntry } from "./types";
import { DEFAULT_BASE_URL } from "./types";
import { isValidSkillId, isValidSource } from "./validation";

/** String non-kosong, atau `null`. */
export function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Parse respons `/api/search`; entri tak valid / tak aman dibuang. */
export function parseSearchResponse(payload: unknown, baseUrl = DEFAULT_BASE_URL): RegistrySkill[] {
  const skills = (payload as { skills?: unknown } | null)?.skills;
  if (!Array.isArray(skills)) return [];
  const out: RegistrySkill[] = [];
  const seen = new Set<string>();
  for (const raw of skills) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const source = str(r.source);
    const skillId = str(r.skillId);
    if (!source || !skillId || !isValidSource(source) || !isValidSkillId(skillId)) continue;
    const id = `${source}/${skillId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: str(r.name) ?? skillId,
      source,
      skillId,
      installs: typeof r.installs === "number" && r.installs >= 0 ? Math.floor(r.installs) : 0,
      url: `${baseUrl}/${id}`,
    });
  }
  return out.sort((a, b) => b.installs - a.installs);
}

const AUDIT_RANK: Record<AuditStatus, number> = { pass: 0, warn: 1, fail: 2 };

/** Parse respons audit; status tak dikenal dianggap `warn` (hati-hati). */
export function parseAuditResponse(payload: unknown): SkillAudit {
  const list = (payload as { audits?: unknown } | null)?.audits;
  if (!Array.isArray(list)) return { audits: null, overall: null };
  const audits: SkillAuditEntry[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const provider = str(r.provider);
    if (!provider) continue;
    const status: AuditStatus =
      r.status === "pass" || r.status === "warn" || r.status === "fail" ? r.status : "warn";
    audits.push({
      provider,
      status,
      summary: str(r.summary) ?? "",
      riskLevel: str(r.riskLevel),
    });
  }
  if (audits.length === 0) return { audits: null, overall: null };
  const overall = audits.reduce<AuditStatus>(
    (worst, a) => (AUDIT_RANK[a.status] > AUDIT_RANK[worst] ? a.status : worst),
    "pass",
  );
  return { audits, overall };
}
