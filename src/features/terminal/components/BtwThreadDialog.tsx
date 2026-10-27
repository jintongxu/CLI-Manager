import { useRef, useState } from "react";
import { useI18n } from "../../../shared/i18n/index";
import { Button } from "../../../shared/ui/button";
import { copyTextToClipboard } from "../../../shared/platform/systemClipboard";
import { btwThreadText, type BtwThread } from "../lib/btwThreadModel";
import { BtwContextDetails } from "./BtwContextDetails";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";
import { activeBtwQuestion, btwQuestions, jumpToBtwQuestion } from "./btwQuestionNavigation";
import "./btwThreadDialog.css";

export type BtwReaderActions = Pick<import("../lib/btwThreadModel").BtwThreadModel,
  "open" | "setDraft" | "reset" | "send" | "stop">;

/** Embeddable reading workspace: no portal, overlay or second inference model. */
export function BtwThreadReader({ model, thread }: { model: BtwReaderActions; thread: BtwThread }) {
  const { t } = useI18n();
  const [reset, setReset] = useState<{ inherit: boolean } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [activeQuestion, setActiveQuestion] = useState<number | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const questions = btwQuestions(thread.messages);
  const pending = thread.status === "pending";
  const retry = thread.status === "failed" || thread.status === "stopped";
  return <main className="btw-reading-workspace" aria-label={thread.title}>
      <header className="btw-reading-header" data-btw-header="true">
        <div className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 truncate">{thread.title}</h1>
          <Button size="sm" variant="ghost" onClick={() => model.open(null)}>{t("terminal.btw.close")}</Button>
        </div>
        <p className="sr-only">{t("terminal.btw.dialogHint")}</p>
        <div className="btw-reading-toolbar">
          <span>{t(thread.inherit ? "terminal.btw.modeInherited" : "terminal.btw.modeIndependent")}</span>
          <details className="btw-reading-settings" data-btw-source-details="true">
            <summary>{t("terminal.btw.contextDetails")}</summary>
            <div className="btw-reading-settings-panel">
              <BtwContextDetails source={thread.source} context={thread.context} loading={thread.contextLoading} />
              <label className="flex items-center gap-2"><input type="checkbox" checked={thread.inherit}
                disabled={thread.contextLoading || !!thread.source.reason || !thread.source.sessionId}
                onChange={(event) => setReset({ inherit: event.target.checked })} />{t("terminal.btw.inherit")}</label>
              {thread.quote && <details><summary>{t("terminal.btw.quoteLabel")}</summary>
                <pre className="whitespace-pre-wrap break-words font-sans">{thread.quote}</pre></details>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setReset({ inherit: thread.inherit })}>{t("terminal.btw.restart")}</Button>
                <Button size="sm" variant="ghost" onClick={() => void copyTextToClipboard(btwThreadText(thread))}>{t("terminal.btw.copyThread")}</Button>
              </div>
            </div>
          </details>
          <button className="btw-outline-toggle" type="button" aria-expanded={outlineOpen}
            onClick={() => setOutlineOpen((open) => !open)}>{t("terminal.btw.questionOutline")} · {questions.length}</button>
        </div>
      </header>
      {reset && <section className="btw-reset-confirmation" role="alert" aria-label={t("terminal.btw.restart")}>
        <h2>{t("terminal.btw.restart")}</h2>
        <p>{t("terminal.btw.confirmReset")}</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => { if (reset) model.reset(thread.id, reset.inherit); setReset(null); }}>{t("terminal.btw.confirm")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setReset(null)}>{t("terminal.btw.cancel")}</Button>
        </div>
      </section>}
      <div className="btw-reading-body" data-outline-open={outlineOpen}>
      <div ref={scroller} className="btw-reading-scroll" data-btw-turns="true"
        onScroll={(event) => setActiveQuestion(activeBtwQuestion(event.currentTarget))}>
        <div className="btw-reading-content">
        {thread.messages.map((message, index) => <article key={index} className={`btw-reading-turn btw-reading-turn-${message.role}`}
          data-btw-question={message.role === "user" ? index : undefined} tabIndex={message.role === "user" ? -1 : undefined}>
          <div className="flex items-center justify-between"><strong>
            {t(message.role === "user" ? "terminal.btw.questionLabel" : "terminal.btw.answerLabel")}</strong>
            <Button size="sm" variant="ghost" onClick={() => void copyTextToClipboard(message.content)}>{t("terminal.btw.copyAnswer")}</Button>
          </div>{message.role === "assistant"
            ? <MarkdownContent content={message.content} linkBehavior="open" className="btw-reading-markdown" />
            : <div className="btw-reading-question">{message.content}</div>}
        </article>)}
        {(pending || retry) && <div className="btw-reading-turn" data-btw-answer={thread.status}>
          <span role="status">{t(`terminal.btw.${thread.status}`)}</span>
          <MarkdownContent content={thread.answer} linkBehavior="open" className="btw-reading-markdown" />
        </div>}
        {thread.error && <p role="alert" data-btw-error="true">{thread.error}</p>}
        </div>
      </div>
      <nav className="btw-question-outline" aria-label={t("terminal.btw.questionOutline")}>
        <h3>{t("terminal.btw.questionOutline")} <span>{questions.length}</span></h3>
        {questions.length === 0 && <p>{t("terminal.btw.noQuestions")}</p>}
        <ol>{questions.map((question, sequence) => <li key={question.index}>
          <button type="button" aria-current={(activeQuestion ?? questions[0]?.index) === question.index ? "location" : undefined}
            onClick={() => {
              if (scroller.current && jumpToBtwQuestion(scroller.current, question.index)) setActiveQuestion(question.index);
            }}>
            <span className="btw-question-number">{sequence + 1}</span><span>{question.snippet || t("terminal.btw.questionLabel")}</span>
          </button>
        </li>)}</ol>
      </nav>
      </div>
      <footer className="btw-reading-composer" data-btw-composer="true">
      <div className="btw-reading-composer-inner">
      <label className="btw-composer-input"><span className="sr-only">{t("terminal.btw.followup")}</span>
        <textarea className="w-full resize-none text-sm leading-relaxed" rows={2} value={thread.draft}
          placeholder={t("terminal.btw.followup")}
          disabled={pending || retry || thread.contextLoading}
          onChange={(event) => model.setDraft(thread.id, event.target.value)} /></label>
      <div className="btw-composer-actions">
        {pending ? <Button size="sm" onClick={() => model.stop(thread.id)}>{t("terminal.btw.stop")}</Button>
          : retry ? <Button size="sm" onClick={() => model.send(thread.id, true)}>{t("terminal.btw.retry")}</Button>
            : <Button size="sm" disabled={!thread.draft.trim() || thread.contextLoading} onClick={() => model.send(thread.id)}>{t("terminal.btw.ask")}</Button>}
      </div>
      </div>
      </footer>
  </main>;
}
