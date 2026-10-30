import type { BtwSideQuestionController } from "../hooks/useBtwSideQuestion";
import { useI18n } from "../../../shared/i18n/index";
import { Button } from "../../../shared/ui/button";

/** Persistence failures remain actionable without conflating them with inference errors. */
export function BtwPersistenceStatus({ controller }: { controller: BtwSideQuestionController }) {
  const { t } = useI18n();
  if (!controller.state.persistenceError) return null;
  return <div role="alert" className="p-2 text-[12px]" data-btw-persistence-error="true">
    <p>{t("terminal.btw.persistenceFailed")}</p>
    <Button size="sm" variant="ghost" onClick={() => void controller.model.retryPersistence()}>{t("terminal.btw.retryPersistence")}</Button>
  </div>;
}
