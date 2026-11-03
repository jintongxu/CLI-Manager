import { useEffect, useState } from "react";
import { Button, Group, Stack, Switch, Text } from "@mantine/core";
import { useQuickChatSettings, QUICK_CHAT_DEFAULTS } from "../../../../shared/preferences/quickChatSettings";
import { useI18n } from "../../../../shared/i18n/index";
import { eventToCombo } from "../../../workspace/api/useKeyboardShortcuts";

export function QuickChatHotkeySettings() {
  const { t } = useI18n();
  const { enabled, shortcut, error, save } = useQuickChatSettings();
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!recording) return;
    const record = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === "Escape") { setRecording(false); return; }
      const combo = event.key === " " ? eventToCombo(event).replace(/ $/, "Space") : eventToCombo(event);
      if (!combo) return;
      void save({ enabled, shortcut: combo }); setRecording(false);
    };
    window.addEventListener("keydown", record, true);
    return () => window.removeEventListener("keydown", record, true);
  }, [recording, enabled, save]);
  return <section className="ui-surface-card rounded-2xl border border-border p-4">
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" fw={600}>{t("chat.quick.title")}</Text>
        <Switch aria-label={t("chat.quick.title")} checked={enabled}
          onChange={event => { void save({ enabled: event.currentTarget.checked, shortcut }); }} />
      </Group>
      <Text size="xs">{t("chat.quick.description")}</Text>
      <Group>
        <Button size="xs" variant="default" disabled={!enabled} onClick={() => setRecording(!recording)}>
          {recording ? t("settings.shortcuts.recording") : shortcut || t("settings.shortcuts.notSet")}
        </Button>
        <Button size="xs" variant="subtle" onClick={() => { void save({ enabled, shortcut: "" }); }}>{t("settings.shortcuts.clear")}</Button>
        <Button size="xs" variant="subtle" onClick={() => { void save(QUICK_CHAT_DEFAULTS); }}>{t("settings.shortcuts.resetDefault")}</Button>
      </Group>
      {error && <Text size="xs" c="red" role="alert">{t("chat.quick.shortcutError")}</Text>}
    </Stack>
  </section>;
}
