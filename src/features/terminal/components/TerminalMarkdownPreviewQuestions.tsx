import { useEffect, useMemo, useState } from "react";
import { Check, Copy, MessageSquare } from "../../../shared/ui/icons";
import { useI18n } from "../../../shared/i18n/index";
import { copyTextToClipboard } from "../../../shared/platform/systemClipboard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../shared/ui/dialog";

export interface MarkdownPreviewQuestion {
  messageIndex: number;
  content: string;
  timestamp: string | null;
}

const QUESTIONS_PAGE_SIZE = 5;

interface TerminalMarkdownPreviewQuestionsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questions: MarkdownPreviewQuestion[];
  formatTime: (timestamp: string | null) => string;
}

export function TerminalMarkdownPreviewQuestions({
  open,
  onOpenChange,
  questions,
  formatTime,
}: TerminalMarkdownPreviewQuestionsProps) {
  const { t } = useI18n();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(questions.length / QUESTIONS_PAGE_SIZE));
  const latestFirstQuestions = useMemo(() => [...questions].reverse(), [questions]);
  const visibleQuestions = latestFirstQuestions.slice(
    page * QUESTIONS_PAGE_SIZE,
    (page + 1) * QUESTIONS_PAGE_SIZE,
  );

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages - 1));
  }, [totalPages]);

  const copyQuestion = async (question: MarkdownPreviewQuestion) => {
    try {
      await copyTextToClipboard(question.content);
      setCopiedIndex(question.messageIndex);
      window.setTimeout(() => setCopiedIndex((current) => (
        current === question.messageIndex ? null : current
      )), 1800);
    } catch {
      setCopiedIndex(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-4" aria-labelledby="markdown-preview-questions-title">
        <DialogHeader className="pr-7">
          <DialogTitle id="markdown-preview-questions-title" className="flex items-center gap-2 text-sm">
            <MessageSquare size={15} className="text-[var(--primary)]" aria-hidden="true" />
            {t("terminal.markdownPreview.questionsTitle")}
            <span className="text-xs font-normal text-text-muted">({questions.length})</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("terminal.markdownPreview.questionsDescription")}
          </DialogDescription>
        </DialogHeader>
        {questions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-xs text-text-muted">
            {t("terminal.markdownPreview.questionsEmpty")}
          </div>
        ) : (
          <div className="ui-scrollbar max-h-[min(60vh,520px)] space-y-2 overflow-y-auto pr-1">
            {visibleQuestions.map((question, index) => {
              const copied = copiedIndex === question.messageIndex;
              return (
                <article
                  key={`${question.messageIndex}-${index}`}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-container-low)] p-3"
                >
                  <div className="mb-1 flex items-center justify-between gap-3 text-[10px] text-text-muted">
                    <span>{formatTime(question.timestamp)}</span>
                    <button
                      type="button"
                      onClick={() => void copyQuestion(question)}
                      className="ui-focus-ring inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-text-secondary transition hover:bg-[var(--interactive-hover-bg)] hover:text-text-primary"
                      aria-label={copied
                        ? t("terminal.markdownPreview.questionCopied")
                        : t("terminal.markdownPreview.copyQuestion")}
                      title={copied
                        ? t("terminal.markdownPreview.questionCopied")
                        : t("terminal.markdownPreview.copyQuestion")}
                    >
                      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                      <span>{copied
                        ? t("terminal.markdownPreview.questionCopied")
                        : t("terminal.markdownPreview.copyQuestion")}</span>
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-xs leading-5 text-text-primary">
                    {question.content}
                  </p>
                </article>
              );
            })}
          </div>
        )}
        {questions.length > QUESTIONS_PAGE_SIZE && (
          <nav className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3" aria-label={t("terminal.markdownPreview.questionsPagination")}>
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0}
              className="ui-focus-ring rounded-md px-2 py-1 text-xs text-text-secondary transition hover:bg-[var(--interactive-hover-bg)] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t("terminal.markdownPreview.questionsPreviousPage")}
            >
              ← {t("terminal.markdownPreview.questionsPreviousPage")}
            </button>
            <span className="text-[11px] text-text-muted" aria-live="polite">
              {t("terminal.markdownPreview.questionsPage", { page: page + 1, total: totalPages })}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
              disabled={page >= totalPages - 1}
              className="ui-focus-ring rounded-md px-2 py-1 text-xs text-text-secondary transition hover:bg-[var(--interactive-hover-bg)] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t("terminal.markdownPreview.questionsNextPage")}
            >
              {t("terminal.markdownPreview.questionsNextPage")} →
            </button>
          </nav>
        )}
      </DialogContent>
    </Dialog>
  );
}
