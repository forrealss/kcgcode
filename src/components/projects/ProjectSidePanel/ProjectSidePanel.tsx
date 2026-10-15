/**
 * Panel samping halaman Project — Instructions, MCP server, dan Skills dalam
 * satu kolom di kanan daftar Session.
 *
 * Gaya libadwaita (GNOME Settings), memakai primitif `settings/prefs`:
 * tiap seksi = AdwPreferencesGroup (judul + deskripsi di luar kotak, aksi
 * datar di kanan judul) berisi "boxed list". Baris = AdwActionRow /
 * AdwExpanderRow; kolom cari & filter (GtkSearchEntry, AdwToggleGroup) ada di
 * antara judul dan kotak.
 *
 * MCP & Skills dibaca dari KEDUA agent (OpenCode & Claude Code) lalu
 * digabung per nama, sama seperti halaman Skills:
 * - MCP (`McpGroup.tsx`): `GET /api/projects/:id/mcp?agent=` — status per
 *   agent (logo + label) di subjudul; yang bermasalah paling atas, error
 *   tampil inline. Server Claude Code dibaca dari config (`.mcp.json`,
 *   `~/.claude.json`); statusnya "Not checked" sampai ada Session Claude Code
 *   yang berjalan. Tombol "⋯" per server: Reconnect / Enable / Disable per
 *   agent (Claude Code menyimpan Enable/Disable di config Project, seperti
 *   `/mcp` CLI).
 * - Skills (`SkillsGroup.tsx`): `GET /api/projects/:id/skills?agent=` — cari
 *   (bila banyak) + filter asal; logo agent yang memuat skill; baris dibuka
 *   untuk deskripsi lengkap & path. Tombol "+" membuka halaman Skills untuk
 *   Project ini; tombol reload memuat ulang skill di agent tanpa restart
 *   (`POST /api/projects/:id/skills/reload?agent=`).
 * Satu agent gagal dibaca tidak menggagalkan yang lain (baris catatan,
 * `rows.tsx`). Tiap seksi memuat & memuat ulang datanya sendiri
 * (`hooks/useAgentLists.ts`).
 */
import { useCallback, useState } from "react";
import { ProjectInstructions } from "@/components/projects/ProjectInstructions";
import { useAgentLists } from "@/hooks/useAgentLists";
import { useMcpActions } from "@/hooks/useMcpActions";
import type { McpServerInfo, Project, SkillInfo } from "@/types";
import { McpGroup } from "./McpGroup";
import { SkillsGroup } from "./SkillsGroup";

export interface ProjectSidePanelProps {
  project: Project;
  onProjectChange: (project: Project) => void;
}

export function ProjectSidePanel({ project, onProjectChange }: ProjectSidePanelProps) {
  const [mcpKey, setMcpKey] = useState(0);
  const [skillsKey, setSkillsKey] = useState(0);
  const reloadMcp = useCallback(() => setMcpKey((k) => k + 1), []);
  const reloadSkills = useCallback(() => setSkillsKey((k) => k + 1), []);
  const [mcp, setMcpList] = useAgentLists<McpServerInfo>(
    `/api/projects/${project.id}/mcp`,
    "mcp",
    mcpKey,
  );
  const [skills] = useAgentLists<SkillInfo>(
    `/api/projects/${project.id}/skills`,
    "skills",
    skillsKey,
  );
  // Aksi MCP membalas daftar terbaru agent itu; tidak terbaca -> muat ulang.
  const mcpActions = useMcpActions(project.id, (agent, servers) =>
    servers ? setMcpList(agent, servers) : reloadMcp(),
  );

  return (
    <div className="flex flex-col gap-6">
      <ProjectInstructions project={project} onSaved={onProjectChange} />
      <McpGroup state={mcp} onReload={reloadMcp} actions={mcpActions} />
      <SkillsGroup state={skills} projectId={project.id} onReloaded={reloadSkills} />
    </div>
  );
}
