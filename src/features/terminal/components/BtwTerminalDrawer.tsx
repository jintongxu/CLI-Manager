import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../../shared/i18n/index";
import { Button } from "../../../shared/ui/button";
import { CircleStop, Copy, Maximize2, Minimize2, RefreshCw, X } from "../../../shared/ui/icons";
import { copyTextToClipboard } from "../../../shared/platform/systemClipboard";
import { SessionTranscriptContent } from "../../history/api/SessionTranscriptContent";
import { useTerminalPreviewTheme } from "../api/useTerminalPreviewTheme";
import { BtwContextDetails } from "./BtwContextDetails";
import type { BtwSideQuestionController } from "../hooks/useBtwSideQuestion";
import { btwThreadText } from "../lib/btwThreadModel";
import { btwContentChanged, btwReaderScrolled, btwResumeFollowing, btwScrollTarget } from "../lib/btwBottomFollow";
import "./btwTerminalDrawer.css";
import { BtwPersistenceStatus } from "./BtwPersistenceStatus";

const clampWidth = (value: number) => Math.min(760, Math.max(280, Math.round(value)));

/**
 * Right split with owner-model embedded selection, independent of native reveal.
 */
export function BtwTerminalDrawer({ controller, onClose }: { controller: BtwSideQuestionController; onClose: () => void }) {
  const { t } = useI18n();
  const { state, model } = controller;
  const { tone: terminalCodeTheme, panelStyle } = useTerminalPreviewTheme();
  const collapsed = state.collapsed;
  const setCollapsed = (value: boolean | ((previous: boolean) => boolean)) => model.setCollapsed(typeof value === "function" ? value(collapsed) : value);
  const [unread, setUnread] = useState(false);
  const [width, setWidth] = useState(420);
  const resize = useRef<{ x: number; width: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const thread = state.embeddedId ? state.entries.find((entry) => entry.id === state.embeddedId) ?? null : null;
  const pending = thread?.status === "pending" || !!thread?.contextLoading;
  const retryable = thread?.status === "failed" || thread?.status === "stopped";

  // Streaming updates must not steal terminal focus.
  useEffect(() => {
    if (!thread && !collapsed) inputRef.current?.focus();
  }, [state.stageVersion, collapsed, thread?.id]);
  // A saved non-following reader is restored before applying any content update.
  // Completion is included: the final response can contain text not emitted as a chunk.
  useEffect(() => {
    if (!thread) { setUnread(false); return; }
    const content = JSON.stringify([thread.messages, thread.answer, thread.error]);
    const reader = btwContentChanged(model.getReader(thread.id), content);
    model.setReader(thread.id, reader);
    setUnread(reader.unread);
    const scroller = transcriptRef.current;
    const restore = () => {
      if (!scroller || !scroller.clientHeight) return; // Git/closed panels have no geometry.
      scroller.scrollTop = btwScrollTarget(model.getReader(thread.id), scroller);
    };
    restore();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(restore);
    if (scroller) {
      observer?.observe(scroller);
      for (const child of scroller.children) observer?.observe(child);
    }
    return () => observer?.disconnect();
  }, [model, collapsed, state.terminalId, thread?.id, thread?.messages, thread?.answer, thread?.error]);

  const submitQuestion = () => {
    if (model.submitEmbedded()) setCollapsed(false);
  };
  const sendFollowUp = () => {
    if (!thread || pending) return;
    const question = thread.draft.trim();
    if (!question) return;
    model.setDraft(thread.id, question);
    model.send(thread.id);
  };
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = { x: event.clientX, width };
  };
  const composerValue = thread ? thread.draft : state.question;
  const composerSet = thread ? (value: string) => model.setDraft(thread.id, value) : model.setQuestion;
  const composerSubmit = thread ? sendFollowUp : submitQuestion;
  const composerDisabled = thread ? pending || !thread.draft.trim() : !state.question.trim() || (state.inherit && state.contextLoading);

  return (
    <section
      className="btw-drawer"
      data-btw-drawer="true"
      data-collapsed={collapsed ? "true" : "false"}
      aria-label={t("terminal.btw.title")}
      style={{ ...panelStyle, width: collapsed ? 160 : width }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        setCollapsed(true);
      }}
    >
      <header className="btw-drawer-header">
        <span className="btw-drawer-status" data-btw-drawer-status={thread?.status ?? "idle"}>
          <span className="btw-drawer-dot" aria-hidden="true" />
          <span className="btw-drawer-status-text">
            {t("terminal.btw.title")}
            {thread ? ` · ${t(thread.contextLoading ? "terminal.btw.contextLoading" : `terminal.btw.${thread.status}`)}` : ""}
            {thread ? ` · ${t(thread.inherit ? "terminal.btw.modeInherited" : "terminal.btw.modeIndependent")}` : ""}
          </span>
        </span>
        <div className="btw-drawer-actions">
          {pending && thread ? (
            <Button size="sm" variant="ghost" data-btw-drawer-action="stop" onClick={() => model.stop(thread.id)}>
              <CircleStop size={13} aria-hidden="true" />{t("terminal.btw.drawerStop")}
            </Button>
          ) : null}
          {retryable && thread ? (
            <Button size="sm" variant="ghost" data-btw-drawer-action="retry" onClick={() => model.send(thread.id, true)}>
              <RefreshCw size={13} aria-hidden="true" />{t("terminal.btw.drawerRetry")}
            </Button>
          ) : null}
          {thread ? (
            <Button size="sm" variant="ghost" data-btw-drawer-action="copy" onClick={() => void copyTextToClipboard(btwThreadText(thread))}>
              <Copy size={13} aria-hidden="true" />{t("terminal.btw.copyAnswer")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            aria-label={collapsed ? t("terminal.btw.drawerExpand") : t("terminal.btw.drawerCollapse")}
            data-btw-drawer-action="toggle"
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <Maximize2 size={13} aria-hidden="true" /> : <Minimize2 size={13} aria-hidden="true" />}
          </Button>
          <Button size="sm" variant="ghost" aria-label={t("terminal.btw.drawerClose")} data-btw-drawer-action="close" onClick={onClose}>
            <X size={13} aria-hidden="true" />
          </Button>
        </div>
      </header>
      <BtwPersistenceStatus controller={controller} />
      {collapsed ? null : (
        <>
          <div
            className="btw-drawer-resizer"
            role="separator"
            aria-orientation="vertical"
            tabIndex={0}
            aria-valuemin={280}
            aria-valuemax={760}
            aria-valuenow={width}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              setWidth(clampWidth(width + (event.key === "ArrowLeft" ? 20 : -20)));
            }}
            onPointerMove={(event) => {
              if (resize.current) setWidth(clampWidth(resize.current.width + resize.current.x - event.clientX));
            }}
            onPointerUp={() => { resize.current = null; }}
            onPointerCancel={() => { resize.current = null; }}
            onLostPointerCapture={() => { resize.current = null; }}
            aria-label={t("terminal.btw.drawerResize")}
            onPointerDown={startResize}
          />
          {thread ? (
            <div className="btw-drawer-transcript" key={thread.id} ref={transcriptRef}
              onScroll={(event) => {
                const scroller = event.currentTarget;
                if (!scroller.clientHeight) return;
                const reader = btwReaderScrolled(model.getReader(thread.id), scroller);
                model.setReader(thread.id, reader);
                setUnread(reader.unread);
              }}>
              {thread.quote ? (
                <details className="btw-drawer-quote" data-btw-drawer-quote="true">
                  <summary>{t("terminal.btw.drawerQuote")}</summary>
                  <pre>{thread.quote}</pre>
                </details>
              ) : null}
              {thread.messages.map((message, index) => message.role === "user" ? (
                <p key={`q-${index}`} className="btw-drawer-question">{message.content}</p>
              ) : (
                <SessionTranscriptContent key={`a-${index}`} content={message.content} variant="terminal"
                  terminalCodeTheme={terminalCodeTheme} markdownClassName="subagent-transcript-markdown" />
              ))}
              {thread.status !== "done" && thread.answer ? (
                <SessionTranscriptContent content={thread.answer} variant="terminal"
                  terminalCodeTheme={terminalCodeTheme} markdownClassName="subagent-transcript-markdown" />
              ) : pending ? <p className="btw-drawer-hint">{t("terminal.btw.pending")}</p> : null}
              {thread.error ? <p className="btw-drawer-error" data-btw-drawer-error="true">{thread.error}</p> : null}
            </div>
          ) : (
            <div className="btw-drawer-staged" data-btw-drawer-staged="true">
              {state.quote ? (
                <details open className="btw-drawer-quote" data-btw-drawer-quote="true">
                  <summary>{t("terminal.btw.drawerQuote")}</summary>
                  <pre>{state.quote}</pre>
                </details>
              ) : null}
              <p className="btw-drawer-hint">{t("terminal.btw.drawerHint")}</p>
              <label className="btw-drawer-inherit">
                <input type="checkbox" checked={state.inherit}
                  disabled={!!state.source.reason || !state.source.sessionId}
                  onChange={(event) => model.setInherit(event.target.checked)} />
                {t("terminal.btw.inherit")}
              </label>
              <BtwContextDetails source={state.source} context={state.context} loading={state.contextLoading} />
            </div>
          )}
          <div className="btw-drawer-composer">
            {thread && unread ? <Button size="sm" variant="ghost" data-btw-drawer-action="latest" onClick={() => {
              const reader = btwResumeFollowing(model.getReader(thread.id));
              model.setReader(thread.id, reader);
              const scroller = transcriptRef.current;
              if (scroller) scroller.scrollTop = btwScrollTarget(reader, scroller);
              setUnread(false);
            }}>{t("terminal.btw.newContent")}</Button> : null}
            <textarea
              ref={inputRef}
              className="btw-drawer-input"
              aria-label={thread ? t("terminal.btw.drawerFollowUp") : t("terminal.btw.questionLabel")}
              placeholder={thread ? t("terminal.btw.drawerFollowUp") : t("terminal.btw.drawerPlaceholder")}
              value={composerValue}
              onChange={(event) => composerSet(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                event.preventDefault();
                if (!composerDisabled) composerSubmit();
              }}
            />
            <Button size="sm" variant="default" data-btw-drawer-action="submit" disabled={composerDisabled} onClick={composerSubmit}>
              {t("terminal.btw.ask")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
