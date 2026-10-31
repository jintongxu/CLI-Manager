import { useCallback, useEffect, useState } from "react";
import { Box, Button, Card, Group, Stack, Text, Textarea } from "@mantine/core";
import { RotateCcw } from "lucide-react";
import { useI18n } from "../../../../shared/i18n/index";
import { useSettingsStore } from "../../../../shared/preferences/settingsStore";
import { DEFAULT_TRANSLATOR_PROMPT } from "../../../../shared/preferences/translatorSettings";

/**
 * 翻译提示词模板设置。
 *
 * 默认使用内置的专业翻译提示词（追求原生母语级信达雅、保留 Markdown/代码/公式结构、
 * 只输出译文）。这里允许用户按自己的场景覆盖：留空即回落默认模板。
 */
export function TranslatorPromptSetting() {
  const { t } = useI18n();
  const storedPrompt = useSettingsStore((s) => s.translatorPrompt);
  const update = useSettingsStore((s) => s.update);
  const [draft, setDraft] = useState(storedPrompt ?? "");

  // 外部（例如「恢复默认」或跨窗口同步）改动后回灌草稿。
  useEffect(() => {
    setDraft(storedPrompt ?? "");
  }, [storedPrompt]);

  const custom = (storedPrompt ?? "").trim().length > 0;
  const missingTextPlaceholder = custom && !(storedPrompt ?? "").includes("{text}");

  const commit = useCallback(
    (value: string) => {
      setDraft(value);
      void update("translatorPrompt", value.trim());
    },
    [update]
  );

  return (
    <Card padding="md" radius="md" className="border border-border/60 bg-surface-container-lowest">
      <Stack>
        <Box>
          <Text size="sm" fw={600} className="text-on-surface">
            {t("settings.translator.prompt.title")}
          </Text>
          <Text size="xs" className="text-on-surface-variant" mt={4}>
            {t("settings.translator.prompt.description")}
          </Text>
        </Box>

        <Textarea
          aria-label={t("settings.translator.prompt.title")}
          autosize
          minRows={6}
          maxRows={18}
          value={draft}
          placeholder={DEFAULT_TRANSLATOR_PROMPT}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={(event) => commit(event.currentTarget.value)}
          styles={{ input: { fontFamily: "var(--font-ui-mono, monospace)", fontSize: 12 } }}
        />

        <Group justify="space-between" align="center" wrap="nowrap">
          <Text size="xs" className={missingTextPlaceholder ? "text-orange-500" : "text-on-surface-variant"}>
            {missingTextPlaceholder
              ? t("settings.translator.prompt.description")
              : custom
                ? t("settings.translator.prompt.isCustom")
                : t("settings.translator.prompt.isDefault")}
          </Text>
          <Button
            variant="default"
            size="xs"
            leftSection={<RotateCcw size={12} />}
            disabled={!custom}
            onClick={() => commit("")}
          >
            {t("settings.translator.prompt.reset")}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
