import { Box, Button, Group, Stack, Text, Title } from "@mantine/core";
import { ExternalLink, Sparkles } from "lucide-react";
import { useI18n } from "../../../../shared/i18n/index";
import { TranslatorModelSetting } from "./TranslatorModelSetting";
import { TranslatorPromptSetting } from "./TranslatorPromptSetting";
import { TranslatorHotkeySettings } from "./TranslatorHotkeySettings";
import type { SettingsTab } from "../../api/SettingsModal";

interface TranslatorSettingsPageProps {
  onNavigateTab?: (tab: SettingsTab) => void;
}

/** 独立的翻译设置标签页：聚合翻译模型选择、模型管理跳转与系统全局热键。 */
export function TranslatorSettingsPage({ onNavigateTab }: TranslatorSettingsPageProps) {
  const { t } = useI18n();

  return (
    <Stack gap="lg">
      <Box>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Box>
            <Title order={2}>{t("settings.tabs.translator.title")}</Title>
            <Text className="text-on-surface-variant" mt={6} size="sm">
              {t("settings.tabs.translator.description")}
            </Text>
          </Box>
          {onNavigateTab ? (
            <Button
              variant="light"
              size="xs"
              leftSection={<Sparkles size={14} />}
              rightSection={<ExternalLink size={12} />}
              onClick={() => onNavigateTab("chat-models")}
            >
              {t("settings.tabs.chatModels.label")}
            </Button>
          ) : null}
        </Group>
      </Box>

      <TranslatorModelSetting />

      <TranslatorPromptSetting />

      <TranslatorHotkeySettings />

    </Stack>
  );
}
