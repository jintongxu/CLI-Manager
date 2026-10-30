import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Card,
  Checkbox,
  Collapse,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { Eye, EyeOff, ListFilter, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useI18n } from "../../../../shared/i18n/index";

type Model = { modelId: string; enabled: boolean; isDefault: boolean };
type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  protocol: string;
  enabled: boolean;
  isDefault: boolean;
  models: Model[];
};

function Pill({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "primary" | "success" | "danger";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "success"
      ? "border-success/40 bg-success/15 text-success"
      : tone === "danger"
        ? "border-danger/40 bg-danger/15 text-danger"
        : tone === "primary"
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border/50 bg-surface-container-high/60 text-on-surface-variant";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${toneClass}`}
    >
      {children}
    </span>
  );
}

const Hairline = () => <Box className="h-px w-full bg-border/50" />;

const protocols = [
  { value: "openai_chat", label: "OpenAI Chat Completions" },
  { value: "openai_responses", label: "OpenAI Responses" },
  { value: "anthropic_messages", label: "Anthropic Messages" },
];

const emptyDraft = () => ({
  id: "",
  name: "",
  baseUrl: "",
  protocol: "openai_chat",
  apiKey: "",
  enabled: true,
  isDefault: false,
});

/** Mirrors the Rust catalog rule: http(s) with a host, no credentials or query. */
function validEndpoint(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !!url.host &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/** Stable fallback id generator for non-ascii names (e.g. Chinese characters). */
function deriveId(name: string, fallbackSuffix = ""): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) return slug;
  return `prov-${fallbackSuffix || Math.random().toString(36).slice(2, 8)}`;
}

export function ChatModelSettingsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<Provider[]>([]);
  const [selected, setSelected] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [idEdited, setIdEdited] = useState(false);
  const [revealKey, setRevealKey] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [testState, setTestState] = useState<"idle" | "pass" | "fail">("idle");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState("");

  // Model Management Modal State
  const [manageOpen, setManageOpen] = useState(false);
  const [fetchingRemote, setFetchingRemote] = useState(false);
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [selectedRemote, setSelectedRemote] = useState<Set<string>>(new Set());
  const [modelSearch, setModelSearch] = useState("");
  const [manageError, setManageError] = useState("");

  const selectedProvider = items.find((item) => item.id === selected);

  const reload = async (preferredId = selected) => {
    const next = await invoke<Provider[]>("chat_provider_catalog_list");
    setItems(next);
    if (next.some((item) => item.id === preferredId)) return;
    if (next[0]) {
      setSelected(next[0].id);
      setDraft({ ...next[0], apiKey: "" });
      setIsNew(false);
    } else {
      setSelected("");
      setIsNew(false);
      setDraft(emptyDraft());
    }
  };

  useEffect(() => {
    void reload().catch(() => setStatus(t("settings.chatModels.loadError")));
  }, []);

  const choose = (id: string) => {
    const provider = items.find((item) => item.id === id);
    if (!provider) return;
    setSelected(id);
    setDraft({ ...provider, apiKey: "" });
    setIsNew(false);
    setTestState("idle");
    setStatus("");
    setRevealKey(false);
  };

  const startNew = () => {
    const fresh = emptyDraft();
    fresh.id = `prov-${Math.random().toString(36).slice(2, 8)}`;
    setDraft(fresh);
    setIsNew(true);
    setIdEdited(false);
    setTestState("idle");
    setStatus("");
    setRevealKey(false);
    setAdvanced(false);
    setModel("");
  };

  const cancelNew = () => {
    if (items[0]) choose(items[0].id);
    else {
      setIsNew(false);
      setDraft(emptyDraft());
    }
  };

  const persistProvider = async (): Promise<string> => {
    if (!draft.name.trim() || !validEndpoint(draft.baseUrl)) {
      throw new Error(t("settings.chatModels.fillNameAndUrlFirst"));
    }
    const finalId = draft.id.trim() || deriveId(draft.name);
    const { name, baseUrl, protocol, apiKey, enabled, isDefault } = draft;
    const provider = await invoke<Provider>("chat_provider_catalog_upsert", {
      input: { id: finalId, name, baseUrl, protocol, apiKey, enabled, isDefault },
    });
    setItems((current) => {
      const rest = current.filter((item) => item.id !== provider.id);
      return [...rest, provider];
    });
    setSelected(provider.id);
    setDraft({ ...provider, apiKey: "" });
    setIsNew(false);
    return provider.id;
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setStatus("");
    try {
      await persistProvider();
      setStatus(t("settings.chatModels.saved"));
    } catch (err) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || t("settings.chatModels.saveError");
      setStatus(msg);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    try {
      await invoke("chat_provider_catalog_delete", { id: selected });
      await reload("");
    } catch {
      setStatus(t("settings.chatModels.saveError"));
    }
  };

  const runTest = async () => {
    if (testing || !validEndpoint(draft.baseUrl)) return;
    setTesting(true);
    setStatus("");
    try {
      if (!isNew && selected) {
        await invoke("chat_provider_test", { id: selected });
      } else {
        await invoke("chat_provider_test_probe", {
          input: {
            baseUrl: draft.baseUrl.trim(),
            protocol: draft.protocol,
            apiKey: draft.apiKey.trim() || undefined,
          },
        });
      }
      setTestState("pass");
      setStatus(t("settings.chatModels.testPassed"));
    } catch (err) {
      setTestState("fail");
      const msg = typeof err === "string" ? err : String(err);
      setStatus(`${t("settings.chatModels.testFailed")} (${msg})`);
    } finally {
      setTesting(false);
    }
  };

  // Model Management Dialog Handlers
  const openManageModels = async () => {
    setManageOpen(true);
    setManageError("");
    setFetchingRemote(true);

    // Initialize selection from existing provider models
    const existing = new Set(
      selectedProvider?.models.filter((m) => m.enabled).map((m) => m.modelId) || []
    );
    setSelectedRemote(existing);

    try {
      let fetched: string[] = [];
      if (!isNew && selected) {
        fetched = await invoke<string[]>("chat_provider_fetch_remote_models", {
          id: selected,
          probe: null,
        });
      } else {
        fetched = await invoke<string[]>("chat_provider_fetch_remote_models", {
          id: null,
          probe: {
            baseUrl: draft.baseUrl.trim(),
            protocol: draft.protocol,
            apiKey: draft.apiKey.trim() || undefined,
          },
        });
      }
      setRemoteModels(fetched);
    } catch (e) {
      setManageError(String(e));
      setRemoteModels(selectedProvider?.models.map((m) => m.modelId) || []);
    } finally {
      setFetchingRemote(false);
    }
  };

  const toggleModelSelection = (mId: string) => {
    setSelectedRemote((curr) => {
      const next = new Set(curr);
      if (next.has(mId)) next.delete(mId);
      else next.add(mId);
      return next;
    });
  };

  const saveManagedModels = async () => {
    setManageError("");
    try {
      let targetId = selected;
      if (isNew || !targetId) {
        targetId = await persistProvider();
      }
      if (!targetId) return;

      const payload = Array.from(selectedRemote).map((mId) => ({
        providerId: targetId,
        modelId: mId,
        enabled: true,
        isDefault: false,
      }));

      await invoke("chat_provider_batch_sync_models", {
        providerId: targetId,
        models: payload,
      });
      await reload(targetId);
      setManageOpen(false);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error)?.message || String(e);
      setManageError(msg);
    }
  };

  const addModel = async () => {
    if (!selected || !model.trim()) return;
    await invoke("chat_provider_model_upsert", {
      input: { providerId: selected, modelId: model.trim(), enabled: true, isDefault: false },
    });
    setModel("");
    await reload(selected);
  };

  const filteredRemoteModels = useMemo(() => {
    if (!modelSearch.trim()) return remoteModels;
    const q = modelSearch.toLowerCase();
    return remoteModels.filter((m) => m.toLowerCase().includes(q));
  }, [remoteModels, modelSearch]);

  const initial = (draft.name || draft.id || "?").trim().charAt(0).toUpperCase() || "?";
  const statusKey =
    testState === "pass"
      ? "settings.chatModels.statusPassed"
      : testState === "fail"
        ? "settings.chatModels.statusFailed"
        : "settings.chatModels.statusIdle";

  // Relaxed save condition: has a non-empty name and a valid HTTP(S) endpoint URL
  const canSave = !!draft.name.trim() && validEndpoint(draft.baseUrl);
  const endpointError =
    draft.baseUrl.trim() && !validEndpoint(draft.baseUrl) ? t("settings.chatModels.endpointInvalid") : undefined;

  const comboboxProps = {
    classNames: { dropdown: "chat-model-settings-dropdown" },
  } as const;

  const detail = (
    <Stack gap="lg" p="xl" style={{ flex: 1, minWidth: 0 }}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" miw={0}>
          <Box
            w={36}
            h={36}
            fw={700}
            className="grid place-items-center rounded-lg border border-border/50 bg-surface-container-high text-on-surface"
          >
            {initial}
          </Box>
          <Box miw={0}>
            <Text fw={700} size="lg" truncate>
              {isNew ? t("settings.chatModels.newProvider") : draft.name || draft.id}
            </Text>
          </Box>
        </Group>
        <Group gap="sm" wrap="nowrap">
          <Switch
            checked={draft.enabled}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              setDraft((current) => ({ ...current, enabled }));
            }}
            label={t("settings.chatModels.enabled")}
          />
          <Pill tone={testState === "pass" ? "success" : testState === "fail" ? "danger" : "muted"}>
            {t(statusKey)}
          </Pill>
          {!isNew && (
            <ActionIcon variant="subtle" color="red" aria-label={t("settings.chatModels.delete")} onClick={() => void remove()}>
              <Trash2 size={16} />
            </ActionIcon>
          )}
        </Group>
      </Group>
      <Hairline />
      <TextInput
        label={t("settings.chatModels.name")}
        placeholder={t("settings.chatModels.newProvider")}
        value={draft.name}
        onChange={(event) => {
          const name = event.currentTarget.value;
          setDraft((current) => ({
            ...current,
            name,
            id: idEdited ? current.id : deriveId(name, current.id.replace(/^prov-/, "")),
          }));
        }}
      />
      <Stack gap="md">
        <Text fw={600} size="sm" className="text-on-surface-variant">
          {t("settings.chatModels.config")}
        </Text>
        <Select
          label={t("settings.chatModels.authMethod")}
          data={[{ value: "api_key", label: t("settings.chatModels.authApiKey") }]}
          value="api_key"
          disabled
          comboboxProps={comboboxProps}
          description={t("settings.chatModels.authApiKeyOnly")}
        />
        <Group grow align="flex-start" wrap="nowrap">
          <TextInput
            label={t("settings.chatModels.interfaceAddress")}
            placeholder="http://127.0.0.1:8080/v1"
            value={draft.baseUrl}
            error={endpointError}
            onChange={(event) => {
              const baseUrl = event.currentTarget.value;
              setDraft((current) => ({ ...current, baseUrl }));
            }}
          />
          <Select
            label={t("settings.chatModels.protocol")}
            data={protocols}
            value={draft.protocol}
            comboboxProps={comboboxProps}
            onChange={(value) =>
              value && setDraft((current) => ({ ...current, protocol: value }))
            }
          />
        </Group>
        <Stack gap={4}>
          <TextInput
            label={t("settings.chatModels.apiKey")}
            type={revealKey ? "text" : "password"}
            placeholder={t("settings.chatModels.keyPlaceholder")}
            value={draft.apiKey}
            rightSection={
              <ActionIcon variant="subtle" aria-label={t("settings.chatModels.revealKey")} onClick={() => setRevealKey((value) => !value)}>
                {revealKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </ActionIcon>
            }
            onChange={(event) => {
              const apiKey = event.currentTarget.value;
              setDraft((current) => ({ ...current, apiKey }));
            }}
          />
          <Text size="xs" className="text-on-surface-variant">
            {t("settings.chatModels.keyHint")}
          </Text>
        </Stack>
      </Stack>
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Button loading={saving} disabled={!canSave} onClick={() => void save()}>
            {t("settings.chatModels.save")}
          </Button>
          {isNew && (
            <Button variant="default" disabled={saving} onClick={cancelNew}>
              {t("common.cancel")}
            </Button>
          )}
        </Group>
        <Group gap="xs">
          <Button
            variant="default"
            disabled={!validEndpoint(draft.baseUrl)}
            leftSection={<ListFilter size={14} />}
            onClick={() => void openManageModels()}
          >
            {t("settings.chatModels.manageModels")}
          </Button>
          <Button
            variant="light"
            loading={testing}
            disabled={!validEndpoint(draft.baseUrl)}
            leftSection={<RefreshCw size={14} />}
            onClick={() => void runTest()}
          >
            {t("settings.chatModels.test")}
          </Button>
        </Group>
      </Group>
      <Hairline />
      <Group justify="space-between">
        <Text fw={600}>{t("settings.chatModels.models")}</Text>
        <Pill>{selectedProvider?.models.length ?? 0}</Pill>
      </Group>
      <Stack gap="xs">
        {!isNew && selectedProvider?.models.map((item) => (
          <Card
            key={item.modelId}
            padding="sm"
            radius="md"
            className="border border-border/50 bg-surface-container-low/50"
          >
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" ff="monospace" truncate>
                {item.modelId}
              </Text>
              <Group gap="xs" wrap="nowrap">
                <Switch
                  size="sm"
                  checked={item.enabled}
                  onChange={(event) =>
                    void invoke("chat_provider_model_upsert", {
                      input: {
                        providerId: selected,
                        modelId: item.modelId,
                        enabled: event.currentTarget.checked,
                        isDefault: item.isDefault,
                      },
                    }).then(() => reload(selected))
                  }
                />
                <Pill tone={item.isDefault ? "primary" : "muted"}>
                  {item.isDefault ? t("settings.chatModels.defaultModel") : t("settings.chatModels.available")}
                </Pill>
              </Group>
            </Group>
          </Card>
        ))}
        {!isNew && !selectedProvider?.models.length && (
          <Text size="sm" className="text-on-surface-variant">
            {t("settings.chatModels.modelsEmpty")}
          </Text>
        )}
        {!isNew && (
          <Group align="flex-end" wrap="nowrap">
            <TextInput
              flex={1}
              label={t("settings.chatModels.addModelLabel")}
              placeholder={t("settings.chatModels.modelId")}
              value={model}
              onChange={(event) => {
                const val = event.currentTarget.value;
                setModel(val);
              }}
            />
            <Button onClick={() => void addModel()}>{t("settings.chatModels.addModel")}</Button>
          </Group>
        )}
      </Stack>
      <Hairline />
      <Button variant="subtle" size="xs" justify="flex-start" w="fit-content" onClick={() => setAdvanced((value) => !value)}>
        {t("settings.chatModels.advanced")}
      </Button>
      <Collapse expanded={advanced}>
        <Stack gap="md">
          <TextInput
            label={t("settings.chatModels.id")}
            description={t("settings.chatModels.idHint")}
            value={draft.id}
            disabled={!isNew}
            onChange={(event) => {
              const id = event.currentTarget.value;
              setIdEdited(true);
              setDraft((current) => ({ ...current, id }));
            }}
          />
          <Switch
            checked={draft.isDefault}
            label={t("settings.chatModels.defaultProvider")}
            onChange={(event) => {
              const isDefault = event.currentTarget.checked;
              setDraft((current) => ({ ...current, isDefault }));
            }}
          />
        </Stack>
      </Collapse>
      {status && (
        <Text role="status" size="sm" className="text-on-surface-variant">
          {status}
        </Text>
      )}
    </Stack>
  );

  return (
    <Stack gap="lg" w="100%" maw={1120} className="chat-model-settings">
      {/* Manage Remote Models Modal */}
      <Modal
        opened={manageOpen}
        onClose={() => setManageOpen(false)}
        title={t("settings.chatModels.manageModels")}
        size="lg"
        radius="md"
        className="chat-model-settings-modal"
        classNames={{ content: "bg-surface-container-lowest border border-border" }}
      >
        <Stack gap="md">
          <Text size="sm" className="text-on-surface-variant">
            {t("settings.chatModels.manageModelsDesc")}
          </Text>

          <TextInput
            placeholder={t("settings.chatModels.searchModels")}
            leftSection={<Search size={14} />}
            value={modelSearch}
            onChange={(e) => {
              const val = e.currentTarget.value;
              setModelSearch(val);
            }}
          />

          {fetchingRemote ? (
            <Group justify="center" py="xl">
              <Loader size="sm" />
              <Text size="sm" className="text-on-surface-variant">
                {t("settings.chatModels.fetchingModels")}
              </Text>
            </Group>
          ) : (
            <ScrollArea h={320} offsetScrollbars>
              <Stack gap={6}>
                {filteredRemoteModels.map((mId) => {
                  const isChecked = selectedRemote.has(mId);
                  return (
                    <Box
                      key={mId}
                      p="xs"
                      className={`cursor-pointer rounded-md border transition-colors ${
                        isChecked
                          ? "border-primary/50 bg-primary/10"
                          : "border-border/40 bg-surface-container-low/40 hover:bg-surface-container-high/40"
                      }`}
                      onClick={() => toggleModelSelection(mId)}
                    >
                      <Group justify="space-between" wrap="nowrap">
                        <Group gap="xs" wrap="nowrap" miw={0}>
                          <Checkbox
                            checked={isChecked}
                            onChange={() => {}}
                            styles={{ input: { cursor: "pointer" } }}
                          />
                          <Text size="sm" ff="monospace" truncate>
                            {mId}
                          </Text>
                        </Group>
                      </Group>
                    </Box>
                  );
                })}
                {!filteredRemoteModels.length && (
                  <Text size="sm" className="text-on-surface-variant" ta="center" py="xl">
                    {t("settings.chatModels.noModelsFound")}
                  </Text>
                )}
              </Stack>
            </ScrollArea>
          )}

          {manageError && (
            <Text size="xs" c="red" role="alert">
              {manageError}
            </Text>
          )}

          <Group justify="space-between" pt="sm">
            <Group gap="xs">
              <Button
                variant="subtle"
                size="xs"
                onClick={() => setSelectedRemote(new Set(remoteModels))}
              >
                {t("settings.chatModels.selectAll")}
              </Button>
              <Button
                variant="subtle"
                size="xs"
                onClick={() => setSelectedRemote(new Set())}
              >
                {t("settings.chatModels.clearSelection")}
              </Button>
            </Group>
            <Group gap="xs">
              <Button variant="default" onClick={() => setManageOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => void saveManagedModels()}>
                {t("settings.chatModels.applyModels")}
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <Box>
        <Title order={2}>{t("settings.tabs.chatModels.title")}</Title>
        <Text className="text-on-surface-variant" mt={6}>
          {t("settings.tabs.chatModels.description")}
        </Text>
      </Box>
      <Card padding={0} radius="md" className="border border-border/60 bg-surface-container-lowest" style={{ overflow: "hidden" }}>
        <Group align="stretch" gap={0} wrap="nowrap" mih={620}>
          <Stack gap="sm" p="md" w={260} miw={220} className="border-r border-border/50 bg-surface-container-low/50">
            <Button variant="light" leftSection={<Plus size={16} />} onClick={startNew} fullWidth>
              {t("settings.chatModels.addProvider")}
            </Button>
            <Hairline />
            <ScrollArea style={{ flex: 1 }} offsetScrollbars>
              <Stack gap={6}>
                {items.map((provider) => (
                  <Button
                    key={provider.id}
                    variant={provider.id === selected && !isNew ? "light" : "subtle"}
                    justify="flex-start"
                    fullWidth
                    onClick={() => choose(provider.id)}
                  >
                    <Group gap={8} wrap="nowrap" justify="space-between" w="100%">
                      <Group gap={8} wrap="nowrap" miw={0}>
                        <Box w={8} h={8} bg={provider.enabled ? "teal" : "gray"} style={{ borderRadius: 99 }} />
                        <Text truncate size="sm">
                          {provider.name || provider.id}
                        </Text>
                      </Group>
                      <Pill>{provider.models.filter((item) => item.enabled).length}</Pill>
                    </Group>
                  </Button>
                ))}
                {!items.length && (
                  <Text size="sm" className="text-on-surface-variant" ta="center" py="lg">
                    {t("settings.chatModels.empty")}
                  </Text>
                )}
              </Stack>
            </ScrollArea>
          </Stack>
          {isNew || selectedProvider ? (
            detail
          ) : (
            <Stack align="center" justify="center" gap="md" style={{ flex: 1 }}>
              <Text className="text-on-surface-variant">{t("settings.chatModels.empty")}</Text>
              <Button variant="light" leftSection={<Plus size={16} />} onClick={startNew}>
                {t("settings.chatModels.addProvider")}
              </Button>
            </Stack>
          )}
        </Group>
      </Card>
    </Stack>
  );
}
