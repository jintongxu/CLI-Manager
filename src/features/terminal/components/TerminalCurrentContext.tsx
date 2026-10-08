import type { ProjectWorkspanTabModel } from "../api/terminalProjectSelection";
import { workspanContextIdentity } from "../api/terminalProjectTabsModel";
import { useI18n } from "../../../shared/i18n/index";

/** Only actual, scoped active membership can supply the current context. */
export function resolveCurrentTerminalContexts(
  models: readonly ProjectWorkspanTabModel[], workspanId: string | null, sessionId: string | null,
) {
  const model = models.find((item) => item.workspan.id === workspanId);
  const active = model?.members.find((member) => member.sessionId === sessionId);
  if (!active || !model) return [];
  const contexts = new Map([[workspanContextIdentity(active), active]]);
  for (const member of model.members) {
    const key = workspanContextIdentity(member);
    if (!contexts.has(key)) contexts.set(key, member);
  }
  return [...contexts.values()];
}

export function TerminalCurrentContext({ models, workspanId, sessionId }: {
  models: readonly ProjectWorkspanTabModel[]; workspanId: string | null; sessionId: string | null;
}) {
  const { t } = useI18n();
  const contexts = resolveCurrentTerminalContexts(models, workspanId, sessionId);
  if (!contexts.length) return null;
  const projectName = (member: typeof contexts[number]) => models.some((model) => model.members.some((other) =>
    other.projectKey !== member.projectKey && other.project.toLocaleLowerCase() === member.project.toLocaleLowerCase()))
    ? `${member.project} · ${member.projectId ?? member.projectKey}` : member.project;
  return <div className="ui-terminal-current-context" aria-label={t("terminal.context.current")}>
    {contexts.map((member, index) => <div key={workspanContextIdentity(member)} data-current={index === 0 ? "true" : "false"}>
      <span className="ui-terminal-current-context-kind">{t(index === 0 ? "terminal.context.current" : "terminal.context.otherVisible")}: </span>
      <span>{[projectName(member), member.worktreeLabel || null, member.worktreeName ?? t("terminal.context.rootDirectory"),
        member.worktreeKind === "missing-worktree" ? t("terminal.context.worktreeMissing") : null,
        member.branch, member.worktreePath].filter(Boolean).join(" / ")}</span>
    </div>)}
  </div>;
}
