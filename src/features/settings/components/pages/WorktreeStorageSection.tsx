import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Alert, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { useI18n } from "../../../../shared/i18n/index";
import { useSettingsStore } from "../../../../shared/preferences/settingsStore";
import { WorktreeRootSaveError } from "../../../../shared/preferences/worktreeRootPersistence";
import { worktreeRootErrorKey } from "../../../../shared/preferences/worktreeRootErrors";
import { createWorktreeRootEditor } from "../../lib/worktreeRootEditor";

export function WorktreeStorageSection() {
  const { t } = useI18n();
  const root = useSettingsStore(state => state.worktreeDefaultRoot);
  const loaded = useSettingsStore(state => state.loaded);
  const [editor] = useState(() => createWorktreeRootEditor(root, {
    save: value => useSettingsStore.getState().saveWorktreeDefaultRoot(value),
    pick: () => open({ directory: true, multiple: false }),
    getDefaultRoot: () => invoke<string>("git_worktree_get_default_root"),
  }));
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  useEffect(() => { editor.sync(root); }, [editor, root]);
  useEffect(() => { void editor.loadDefault(); }, [editor]);
  const cause = state.error instanceof WorktreeRootSaveError ? state.error.writeError : state.error;
  const errorKey = worktreeRootErrorKey(cause);
  const rollbackFailed = state.error instanceof WorktreeRootSaveError && state.error.rollbackErrors.length > 0;
  return <section className="ui-surface-card rounded-2xl border border-border p-4">
    <Stack gap="sm">
      <Text size="sm" fw={600}>{t("settings.worktreeStorage.title")}</Text>
      <Text size="xs" c="var(--text-muted)">{t("settings.worktreeStorage.description")}</Text>
      <TextInput label={t("settings.worktreeStorage.root")} value={state.draft}
        placeholder={state.defaultRoot ?? ""} disabled={!loaded || state.busy}
        onChange={event => editor.edit(event.currentTarget.value)} />
      <Text size="xs" style={{ overflowWrap: "anywhere" }}>
        {t("settings.worktreeStorage.defaultPath", { path: state.defaultRoot ?? t("settings.worktreeStorage.unavailable") })}
      </Text>
      <Group gap="xs">
        <Button size="xs" variant="light" disabled={!loaded || state.busy} onClick={() => void editor.pick()}>
          {t("settings.worktreeStorage.choose")}
        </Button>
        <Button size="xs" loading={state.busy} disabled={!loaded || state.busy} onClick={() => void editor.save()}>
          {t("settings.worktreeStorage.save")}
        </Button>
        <Button size="xs" variant="default" disabled={!loaded || state.busy} onClick={() => void editor.restoreDefault()}>
          {t("settings.worktreeStorage.restoreDefault")}
        </Button>
      </Group>
      {state.error != null && <Alert color="red" role="alert">
        {t(rollbackFailed ? "settings.worktreeStorage.rollbackFailed" : "settings.worktreeStorage.failed")}
        {errorKey && <Text size="xs">{t(errorKey)}</Text>}
        <Text size="xs" style={{ overflowWrap: "anywhere" }}>{String(state.error)}</Text>
      </Alert>}
      {state.saved && <Text role="status" size="xs" c="teal">{t("settings.worktreeStorage.saved")}</Text>}
    </Stack>
  </section>;
}
