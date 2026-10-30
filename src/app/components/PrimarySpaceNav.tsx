import { useI18n } from "../../shared/i18n/index";
import type { PrimarySpace } from "../../features/workspace/api/primarySpaceState";

export function PrimarySpaceNav({ space, onChange, onOpenSettings }: {
  space: PrimarySpace;
  onChange: (space: PrimarySpace) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  return (
    <nav className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1" aria-label={t("app.spaces.label")}>
      {(["projects", "chat"] as const).map((value) => (
        <button key={value} type="button" className="ui-focus-ring rounded px-3 py-1 text-sm"
          aria-current={space === value ? "page" : undefined} onClick={() => onChange(value)}>
          {t(value === "projects" ? "app.spaces.projects" : "app.spaces.chat")}
        </button>
      ))}
      <button type="button" className="ui-focus-ring ml-auto hidden rounded px-3 py-1 text-sm" onClick={onOpenSettings}>
        {t("app.spaces.settings")}
      </button>
    </nav>
  );
}
