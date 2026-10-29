import { useI18n, pickByLanguage } from "../../shared/i18n/index";
import type { ExitView } from "../exitTransaction";
import { exitFailureLabel, exitResourceLabel } from "../exitMessages";

interface Props {
  view: ExitView;
  notice: string | null;
  onRetry: () => Promise<void>;
  onResume: () => Promise<void>;
}
export function AppExitOverlay({ view, notice, onRetry, onResume }: Props) {
  const { language } = useI18n();
  if (!view.phase) return null;
  const text = (zh: string, en: string) => pickByLanguage(language, zh, en);
  const blocked = view.phase === "blocked";
  return <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-black/80 text-white"
    role="dialog" aria-modal="true" aria-label={text("退出应用", "Exit application")} aria-busy={!blocked}>
    <p>{blocked ? text("退出未完成，应用将保持打开。", "Exit is incomplete. The application will remain open.")
      : view.phase === "saving" ? text("正在保存恢复数据…", "Saving restore data…")
        : text("正在停止本实例的资源…", "Stopping this instance’s resources…")}</p>
    {notice && <p>{notice}</p>}
    {blocked && <>
      <p>{text("恢复数据保留；重试将继续同一清理事务。", "Restore data is retained; retry continues the same cleanup transaction.")}</p>
      {view.receipt?.errors.map((error, index) => <p key={`${error.resourceId}-${index}`}>
        {exitResourceLabel(language, error.resourceId,
          view.receipt?.resources.find((resource) => resource.resourceId === error.resourceId)?.kind)}
        {": "}{exitFailureLabel(language, error.code)} ({error.code})
      </p>)}
      {view.error && <p className="max-w-xl break-words">{view.error}</p>}
      <button className="rounded border px-4 py-2" onClick={() => void onRetry()}>{text("重试退出", "Retry exit")}</button>
      <button className="rounded border px-4 py-2" onClick={() => void onResume()}>{text("恢复使用", "Resume application")}</button>
    </>}
  </div>;
}
