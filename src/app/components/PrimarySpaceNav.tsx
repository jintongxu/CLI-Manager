import { useI18n } from "../../shared/i18n/index";
import type { PrimarySpace } from "../../features/workspace/api/primarySpaceState";

/** Compact segmented switcher placed at the top-left window chrome. */
export function PrimarySpaceNav({ space, onChange, onOpenSettings }: {
  space: PrimarySpace;
  onChange: (space: PrimarySpace) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  return (
    <nav
      className="space-switcher flex shrink-0 items-stretch gap-3"
      aria-label={t("app.spaces.label")}
    >
      {(["projects", "chat"] as const).map((value) => (
        <button
          key={value}
          type="button"
          className="ui-focus-ring space-switcher-item px-1 text-[12px]"
          aria-current={space === value ? "page" : undefined}
          onClick={() => onChange(value)}
        >
          {t(value === "projects" ? "app.spaces.projects" : "app.spaces.chat")}
        </button>
      ))}
      <button
        type="button"
        className="ui-focus-ring hidden rounded px-2 py-[2px] text-[12px] leading-4"
        onClick={onOpenSettings}
      >
        {t("app.spaces.settings")}
      </button>
    </nav>
  );
}
