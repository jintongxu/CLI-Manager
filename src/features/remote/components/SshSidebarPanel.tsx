import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Search, Settings, Terminal, Wifi } from "lucide-react";
import { useI18n } from "../../../shared/i18n";
import { useSshHostStore } from "../api/sshHostStore";
import { SshHostAttachmentDialog } from "../../settings/api/SshHostAttachmentDialog";
import type { SshHost } from "../../../shared/types/index";

interface Props {
  onOpenSettings: () => void;
  onOpenTerminal: (host: SshHost) => void;
  onClose?: () => void;
}

export function SshSidebarPanel({ onOpenSettings, onOpenTerminal, onClose }: Props) {
  const { t } = useI18n();
  const hosts = useSshHostStore((state) => state.hosts);
  const loaded = useSshHostStore((state) => state.loaded);
  const fetchHosts = useSshHostStore((state) => state.fetchHosts);
  const [query, setQuery] = useState("");
  const [sftpHost, setSftpHost] = useState<SshHost | null>(null);

  useEffect(() => {
    if (!loaded) void fetchHosts();
  }, [fetchHosts, loaded]);

  const filteredHosts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return hosts;
    return hosts.filter((host) => [host.name, host.host, host.username, host.config_alias]
      .some((value) => value.toLocaleLowerCase().includes(needle)));
  }, [hosts, query]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-lowest">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Wifi size={15} className="text-primary" />
        <span className="min-w-0 flex-1 text-sm font-semibold text-text-primary">{t("sidebar.ssh.title")}</span>
        <button type="button" className="ui-icon-action" aria-label={t("sidebar.ssh.settings")} title={t("sidebar.ssh.settings")} onClick={() => { onClose?.(); onOpenSettings(); }}><Settings size={14} /></button>
      </div>
      <div className="border-b border-border px-3 py-2">
        <label className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-xs text-text-muted">
          <Search size={13} />
          <input className="min-w-0 flex-1 bg-transparent text-text-primary outline-none" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("sidebar.ssh.search")} />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!loaded ? <div className="p-3 text-xs text-text-muted">{t("common.loading")}</div> : filteredHosts.length === 0 ? (
          <div className="p-3 text-center text-xs text-text-muted">{query ? t("sidebar.ssh.noMatches") : t("sidebar.ssh.empty")}</div>
        ) : filteredHosts.map((host) => (
          <div key={host.id} className="mb-2 rounded-lg border border-border bg-surface-low px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-text-muted" title={t("sidebar.ssh.notConnected")} />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary" title={host.name}>{host.name}</span>
            </div>
            <div className="mt-1 truncate text-[10px] text-text-muted">{host.config_alias || `${host.username}@${host.host}:${host.port}`}</div>
            <div className="mt-2 flex items-center gap-1.5">
              <button type="button" className="ui-icon-action flex-1" title={t("sidebar.ssh.openTerminal")} aria-label={t("sidebar.ssh.openTerminal")} onClick={() => { onClose?.(); onOpenTerminal(host); }}><Terminal size={13} /></button>
              <button type="button" className="ui-icon-action flex-1" title={t("sidebar.ssh.openSftp")} aria-label={t("sidebar.ssh.openSftp")} onClick={() => setSftpHost(host)}><FolderOpen size={13} /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-2">
        <button type="button" className="w-full rounded border border-border px-2 py-1.5 text-xs text-text-secondary hover:bg-surface-high" onClick={() => { onClose?.(); onOpenSettings(); }}>{t("sidebar.ssh.manage")}</button>
      </div>
      <SshHostAttachmentDialog open={Boolean(sftpHost)} host={sftpHost} onOpenChange={(open) => { if (!open) setSftpHost(null); }} />
    </div>
  );
}
