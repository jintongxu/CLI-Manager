import { worktreeCreationPhase } from "../api/worktreeCreationRecovery";
import { useId } from "react";
import { useI18n } from "../../../shared/i18n/index";
import { normalizeWorktreeShortLabel } from "../api/worktreeLabels";

export function worktreeLabelErrorKey(error: unknown) {
  const message = String(error);
  if (worktreeCreationPhase(error)) return null;
  for (const code of ["too_long", "reserved", "invalid", "conflict"] as const) {
    if (message.includes(`worktree_short_label_${code}`)) return `worktree.shortLabel.${code}` as const;
  }
  if (/worktree_label_(?:ordinal_)?exhausted|worktree_label_high_water/i.test(message)) return "worktree.shortLabel.exhausted" as const;
  return null;
}

/** Preserve outer phase/identity; translate only the nested cause. */
export function worktreeCreationErrorDescription(error: unknown, t: (key: "worktree.shortLabel.conflict" | "worktree.shortLabel.exhausted" | "worktree.shortLabel.too_long" | "worktree.shortLabel.reserved" | "worktree.shortLabel.invalid" | "worktree.recovery.save" | "worktree.recovery.saved") => string): string {
  const phase = worktreeCreationPhase(error);
  if (!phase) {
    const key = worktreeLabelErrorKey(error);
    return key ? t(key) : String(error);
  }
  const message = String(error);
  const causeKey = worktreeLabelErrorKey(message.replace(/worktree_record_(save|readback|refresh|terminal)_failed:/g, ""));
  return `${t(phase === "save" ? "worktree.recovery.save" : "worktree.recovery.saved")}
${message}${causeKey ? `
${t(causeKey)}` : ""}`;
}

export function WorktreeShortLabelField({ value, onChange, defaultLabel }: {
  value: string; onChange: (value: string) => void; defaultLabel?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  let error: ReturnType<typeof worktreeLabelErrorKey> = null;
  try { normalizeWorktreeShortLabel(value); } catch (reason) { error = worktreeLabelErrorKey(reason); }
  return <div className="mt-3">
    <label htmlFor={id} className="block text-xs text-text-muted">{t("worktree.shortLabel.label")}</label>
    <input id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)}
      aria-invalid={!!error} aria-describedby={`${id}-help`}
      className="mt-1 w-full rounded border border-border bg-transparent px-2 py-1 text-sm" />
    <p id={`${id}-help`} className="mt-1 text-xs text-text-muted">{defaultLabel
      ? t("worktree.shortLabel.editHelp", { label: defaultLabel }) : t("worktree.shortLabel.createHelp")}</p>
    {error && <p role="alert" className="text-xs text-danger">{t(error)}</p>}
  </div>;
}
