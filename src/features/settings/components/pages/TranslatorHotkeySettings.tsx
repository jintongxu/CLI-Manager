import { useCallback, useEffect, useState } from "react";
import { Box, Button, Group, Kbd, Stack, Switch, Text } from "@mantine/core";
import {
  DEFAULT_TRANSLATOR_GLOBAL_SHORTCUTS,
  type TranslatorGlobalShortcuts,
} from "../../../../shared/preferences/translatorSettings";
import { useSettingsStore } from "../../../../shared/preferences/settingsStore";
import { eventToCombo } from "../../../workspace/api/useKeyboardShortcuts";
import { useI18n, type TranslationKey } from "../../../../shared/i18n/index";

type TranslatorHotkeyField = "input" | "selection" | "screenshot";

const FIELDS: { field: TranslatorHotkeyField; labelKey: TranslationKey }[] = [
  { field: "input", labelKey: "translator.hotkey.input" },
  { field: "selection", labelKey: "translator.hotkey.selection" },
  { field: "screenshot", labelKey: "translator.hotkey.screenshot" },
];

/** 全局翻译快捷键设置：这三条热键由 Rust 侧注册，应用在后台时同样生效。 */
export function TranslatorHotkeySettings() {
  const { t } = useI18n();
  const shortcuts = useSettingsStore((s) => s.translatorGlobalShortcuts);
  const update = useSettingsStore((s) => s.update);
  const [recording, setRecording] = useState<TranslatorHotkeyField | null>(null);

  const save = useCallback(
    (next: TranslatorGlobalShortcuts) => {
      void update("translatorGlobalShortcuts", next);
    },
    [update]
  );

  const handleRecord = useCallback(
    (event: KeyboardEvent) => {
      if (!recording) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      const combo = eventToCombo(event);
      if (!combo) return;
      save({ ...shortcuts, [recording]: combo });
      setRecording(null);
    },
    [recording, save, shortcuts]
  );

  useEffect(() => {
    if (!recording) return;
    window.addEventListener("keydown", handleRecord, true);
    return () => window.removeEventListener("keydown", handleRecord, true);
  }, [recording, handleRecord]);

  return (
    <section className="ui-surface-card rounded-2xl border border-border p-4">
      <Stack gap="sm">
        <Group justify="space-between" align="center" gap="md">
          <Box>
            <Text size="sm" fw={600} c="var(--on-surface)">
              {t("translator.hotkey.section")}
            </Text>
            <Text mt={4} size="xs" c="var(--on-surface-variant)">
              {t("translator.hotkey.description")}
            </Text>
          </Box>
          <Group gap="xs">
            <Switch
              size="sm"
              checked={shortcuts.enabled}
              onChange={(event) => save({ ...shortcuts, enabled: event.currentTarget.checked })}
              aria-label={t("translator.hotkey.section")}
            />
            <Button
              type="button"
              size="xs"
              variant="default"
              color="gray"
              onClick={() => {
                save({ ...DEFAULT_TRANSLATOR_GLOBAL_SHORTCUTS });
                setRecording(null);
              }}
            >
              {t("settings.shortcuts.resetDefault")}
            </Button>
          </Group>
        </Group>

        <Stack gap="xs">
          {FIELDS.map(({ field, labelKey }) => {
            const value = shortcuts[field];
            const isRecording = recording === field;
            return (
              <Group key={field} justify="space-between" align="center" gap="md" wrap="nowrap">
                <Text size="xs" c="var(--on-surface)">
                  {t(labelKey)}
                </Text>
                <Group gap={6} wrap="nowrap">
                  <Button
                    type="button"
                    size="xs"
                    variant={isRecording ? "light" : "default"}
                    color={isRecording ? "cliPrimary" : "gray"}
                    disabled={!shortcuts.enabled}
                    onClick={() => setRecording(isRecording ? null : field)}
                  >
                    {isRecording ? t("settings.shortcuts.recording") : value || t("settings.shortcuts.notSet")}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="subtle"
                    color="gray"
                    disabled={!shortcuts.enabled || !value}
                    onClick={() => save({ ...shortcuts, [field]: "" })}
                  >
                    {t("settings.shortcuts.clear")}
                  </Button>
                </Group>
              </Group>
            );
          })}
        </Stack>

        <Text size="xs" c="var(--on-surface-variant)">
          <Kbd size="xs">{shortcuts.input || "—"}</Kbd> · <Kbd size="xs">{shortcuts.selection || "—"}</Kbd> ·{" "}
          <Kbd size="xs">{shortcuts.screenshot || "—"}</Kbd>
        </Text>
      </Stack>
    </section>
  );
}
