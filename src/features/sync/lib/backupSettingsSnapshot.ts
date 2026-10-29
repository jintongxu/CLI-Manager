import { appearancePreview, useSettingsStore } from "../../../shared/preferences/settingsStore";
import { pickSyncableSettings } from "./syncSettings";

/** All local/cloud/exit backups share this boundary. Presentation state can contain
 * a live preview: replace only its five appearance keys with committed values.
 * Reading is synchronous and does not cancel or otherwise take over the dialog. */
export function readBackupPreferences() {
  return pickSyncableSettings({
    ...useSettingsStore.getState(),
    ...appearancePreview.getCommittedValues(),
  });
}
