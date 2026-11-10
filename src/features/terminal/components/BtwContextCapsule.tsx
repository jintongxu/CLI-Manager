import { useI18n } from "../../../shared/i18n/index";
import type { BtwContext, BtwSource } from "../lib/btwThreadModel";
import { BtwContextDetails } from "./BtwContextDetails";
import { Button } from "../../../shared/ui/button";

export function BtwContextCapsule({
  source,
  context,
  loading,
  inherited,
  quote,
  imageCount = 0,
  onRefresh,
}: {
  source: BtwSource;
  context: BtwContext;
  loading: boolean;
  inherited: boolean;
  quote?: string;
  imageCount?: number;
  onRefresh?: () => void;
}) {
  const { t } = useI18n();
  const hasQuote = Boolean(quote);
  if (!inherited && !hasQuote && imageCount === 0) return null;
  return (
    <details className="btw-context-capsule" data-btw-context-capsule="true">
      <summary className="btw-context-capsule-summary">
        <span className="btw-context-capsule-label">{t("terminal.btw.contextSummary")}</span>
        {inherited && <span className="btw-composer-chip btw-composer-chip-context">✓ {t("terminal.btw.modeInherited")}</span>}
        {hasQuote && <span className="btw-composer-chip">{t("terminal.btw.drawerQuote")}</span>}
        {imageCount > 0 && <span className="btw-composer-chip">{imageCount} {t("terminal.btw.attachedImage")}</span>}
      </summary>
      <div className="btw-context-capsule-panel">
        <BtwContextDetails source={source} context={context} loading={loading} />
        {quote && <div>{t("terminal.btw.quoteLength")}: {quote.length}</div>}
        {inherited && onRefresh && (
          <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={onRefresh}>
            {t("terminal.btw.refreshContext")}
          </Button>
        )}
      </div>
    </details>
  );
}
