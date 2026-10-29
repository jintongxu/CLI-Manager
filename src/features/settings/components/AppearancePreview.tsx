import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Group, Stack, Text } from "@mantine/core";
import { toast } from "sonner";
import { appearancePreview } from "../../../shared/preferences/settingsStore";
import { useI18n } from "../../../shared/i18n";
import { createAppearancePreviewSession, type PreviewFailure } from "../lib/appearancePreviewSession";

const errorKeys = {
  start: "settings.general.previewStartFailed",
  save: "settings.general.previewSaveFailed",
  compensation: "settings.general.previewCompensationFailed",
} as const;

export function useAppearancePreview(active: boolean) {
  const { t } = useI18n();
  const report = useRef((failure: PreviewFailure) => toast.error(t(errorKeys[failure])));
  report.current = failure => toast.error(t(errorKeys[failure]));
  const [session] = useState(() => createAppearancePreviewSession(appearancePreview, failure => report.current(failure)));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const transaction = useSyncExternalStore(appearancePreview.subscribe, appearancePreview.getStatus);
  useEffect(() => {
    session.setEnabled(active);
    return () => session.setEnabled(false);
  }, [active, session]);
  return { session, state, locked: state.phase !== "idle" || transaction.phase === "previewing" || transaction.phase === "confirming" };
}

export function AppearancePreview({ preview, disabled }: {
  preview: ReturnType<typeof useAppearancePreview>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const { session, state } = preview;
  const busy = disabled || state.phase === "starting" || state.phase === "confirming";
  return <Stack gap="xs">
    <Text size="xs">{t("settings.general.previewDescription")}</Text>
    <Group gap="xs">
      <Button size="xs" variant="light" disabled={busy} onClick={() => void session.preview("storm")}>
        {t("settings.general.previewStorm")}
      </Button>
      <Button size="xs" variant="light" disabled={busy} onClick={() => void session.preview("seaSalt")}>
        {t("settings.general.previewSeaSalt")}
      </Button>
    </Group>
    {state.phase !== "idle" && <>
      <Text size="xs" role="status">{t(state.phase === "confirming" ? "settings.general.previewSaving" : "settings.general.previewUnsaved")}</Text>
      <Group gap="xs">
        <Button size="xs" disabled={state.phase !== "previewing"} loading={state.phase === "confirming"} onClick={() => void session.confirm()}>
          {t("settings.general.previewConfirm")}
        </Button>
        <Button size="xs" variant="default" disabled={state.phase === "confirming"} onClick={() => void session.cancel()}>
          {t("settings.general.previewCancel")}
        </Button>
      </Group>
    </>}
    {state.error && <Text size="xs" c="var(--danger)" role="alert">{t(errorKeys[state.error])}</Text>}
  </Stack>;
}
