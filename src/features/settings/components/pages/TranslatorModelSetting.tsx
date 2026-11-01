import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Box, Button, Card, Group, Select, Stack, Text } from "@mantine/core";
import { useSettingsStore } from "../../../../shared/preferences/settingsStore";
import {
  resolveTranslatorModel,
  translatorModelKey,
  translatorModelLabel,
  type TranslatorModelOption,
} from "../../../translator/api/translatorModels";
import { useI18n } from "../../../../shared/i18n/index";

const FOLLOW_DEFAULT = "";

/** 「设置 → 对话模型」中的翻译模型选择：与翻译浮窗共用 translatorModelKey。 */
export function TranslatorModelSetting() {
  const { t } = useI18n();
  const selectedKey = useSettingsStore((s) => s.translatorModelKey);
  const update = useSettingsStore((s) => s.update);
  const [models, setModels] = useState<TranslatorModelOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await invoke<TranslatorModelOption[]>("translator_list_models");
      setModels(next ?? []);
    } catch {
      setModels([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const options = useMemo(
    () => [
      { value: FOLLOW_DEFAULT, label: t("translator.model.followDefault") },
      ...models.map((model) => ({
        value: translatorModelKey(model.providerId, model.modelId),
        label: translatorModelLabel(model),
      })),
    ],
    [models, t]
  );

  const effective = resolveTranslatorModel(models, selectedKey);
  const selectedAvailable = options.some((option) => option.value === selectedKey);
  const staleSelection = selectedKey !== FOLLOW_DEFAULT && !selectedAvailable;

  return (
    <Card padding="md" radius="md" className="border border-border/60 bg-surface-container-lowest">
      <Stack gap="sm">
        <Box>
          <Text size="sm" fw={600} className="text-on-surface">
            {t("translator.model.settingTitle")}
          </Text>
          <Text size="xs" className="text-on-surface-variant" mt={4}>
            {t("translator.model.settingDescription")}
          </Text>
        </Box>
        <Group align="flex-end" gap="sm" wrap="nowrap">
          <Select
            style={{ flex: 1 }}
            aria-label={t("translator.model.settingTitle")}
            data={options}
            value={selectedAvailable ? selectedKey : FOLLOW_DEFAULT}
            disabled={!models.length}
            allowDeselect={false}
            onChange={(value) => void update("translatorModelKey", value ?? FOLLOW_DEFAULT)}
          />
          <Button variant="default" onClick={() => void reload()}>
            {t("translator.model.refresh")}
          </Button>
        </Group>
        <Text size="xs" className="text-on-surface-variant">
          {loaded && !models.length
            ? t("translator.error.noModel")
            : effective
              ? `${t("translator.model.effective")}: ${translatorModelLabel(effective)}`
              : t("translator.model.followDefault")}
        </Text>
        {staleSelection && models.length ? (
          <Text size="xs" c="orange" role="alert">
            {t("translator.model.staleSelection")}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}
