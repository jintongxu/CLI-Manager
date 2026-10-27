import { useI18n } from "../../../shared/i18n/index";
import type { BtwContext, BtwSource } from "../lib/btwThreadModel";

/** Identity is informational, never inferred from a path, title, cwd or focus. */
export function BtwContextDetails({ source, context, loading }: {
  source: BtwSource; context: BtwContext; loading: boolean;
}) {
  const { t } = useI18n();
  const reason = context.reason ?? source.reason ?? "no_source_session";
  const knownReason = reason === "remote_source" ? t("terminal.btw.remoteSource")
    : reason === "no_source_session" ? t("terminal.btw.noSource")
    : reason === "inherit_off" ? t("terminal.btw.reason.inherit_off")
    : reason === "source_identity_missing" ? t("terminal.btw.reason.source_identity_missing")
    : reason === "source_index_unavailable" ? t("terminal.btw.reason.source_index_unavailable")
    : reason === "source_not_found" ? t("terminal.btw.reason.source_not_found")
    : reason === "source_ambiguous" ? t("terminal.btw.reason.source_ambiguous")
    : reason === "source_not_local" ? t("terminal.btw.reason.source_not_local")
    : reason === "source_timeout" ? t("terminal.btw.reason.source_timeout")
    : reason === "source_unreadable" ? t("terminal.btw.reason.source_unreadable")
    : reason === "source_identity_mismatch" ? t("terminal.btw.reason.source_identity_mismatch")
    : reason === "source_text_unavailable" ? t("terminal.btw.reason.source_text_unavailable")
    : reason === "source_read_failed" ? t("terminal.btw.reason.source_read_failed")
    : reason === "source_header_invalid" ? t("terminal.btw.reason.source_header_invalid")
    : reason === "source_parse_failed" ? t("terminal.btw.reason.source_parse_failed")
    : reason === "source_projection_init_failed" ? t("terminal.btw.reason.source_projection_init_failed")
    : reason === "source_projection_failed" ? t("terminal.btw.reason.source_projection_failed")
    : reason === "source_extract_failed" ? t("terminal.btw.reason.source_extract_failed")
    : reason.startsWith("source_process_") ? `${t("terminal.btw.reason.source_process_error")} (${reason})` : reason;
  return <div className="break-all text-[11px] opacity-75" data-btw-context="true">
    <div>{t("terminal.btw.sourceTerminal")}: {source.terminalId ?? t("terminal.btw.noSource")}</div>
    <div>{t("terminal.btw.sourceSession")}: {source.sessionId ?? t("terminal.btw.noSource")}</div>
    <div>{loading ? t("terminal.btw.contextLoading") : context.available
      ? t(context.truncated ? "terminal.btw.contextTruncated" : "terminal.btw.contextAvailable")
      : `${t("terminal.btw.contextUnavailable")}: ${knownReason}`}</div>
  </div>;
}
