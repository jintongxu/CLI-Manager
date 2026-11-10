import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../../shared/i18n/index";
import { Button } from "../../../shared/ui/button";
import { CircleStop, Copy, Image, Maximize2, Minimize2, RefreshCw, X } from "../../../shared/ui/icons";
import { copyTextToClipboard } from "../../../shared/platform/systemClipboard";
import { SessionTranscriptContent } from "../../history/api/SessionTranscriptContent";
import { useTerminalPreviewTheme } from "../api/useTerminalPreviewTheme";
import { BtwContextDetails } from "./BtwContextDetails";
import { BtwContextCapsule } from "./BtwContextCapsule";
import type { BtwSideQuestionController } from "../hooks/useBtwSideQuestion";
import { btwContentText, btwThreadText, type BtwImagePart } from "../lib/btwThreadModel";
import { fileToBtwImage, readBtwImages } from "../lib/btwImageAttachments";
import { btwContentChanged, btwReaderScrolled, btwResumeFollowing, btwScrollTarget } from "../lib/btwBottomFollow";
import "./btwTerminalDrawer.css";
import { BtwPersistenceStatus } from "./BtwPersistenceStatus";

const clampWidth = (value: number) => Math.min(760, Math.max(280, Math.round(value)));

/**
 * Right split with owner-model embedded selection, independent of native reveal.
 */
export function BtwTerminalDrawer({ controller, onClose, onBackHistory }: { controller: BtwSideQuestionController; onClose: () => void; onBackHistory?: () => void }) {
  const { t } = useI18n();
  const { state, model } = controller;
  const { tone: terminalCodeTheme, panelStyle } = useTerminalPreviewTheme();
  const collapsed = state.collapsed;
  const setCollapsed = (value: boolean | ((previous: boolean) => boolean)) => model.setCollapsed(typeof value === "function" ? value(collapsed) : value);
  const [unread, setUnread] = useState(false);
  const [width, setWidth] = useState(420);
  const [showCommandHint, setShowCommandHint] = useState(false);
  const [images, setImages] = useState<BtwImagePart[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const resize = useRef<{ x: number; width: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const thread = state.embeddedId ? state.entries.find((entry) => entry.id === state.embeddedId) ?? null : null;
  const pending = thread?.status === "pending" || !!thread?.contextLoading;
  const retryable = thread?.status === "failed" || thread?.status === "stopped";

  useEffect(() => setImages(thread?.draftImages ?? []), [thread?.id, thread?.generation]);
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
    if (model.submitEmbedded(images)) { setImages([]); setCollapsed(false); }
  };
  const addImages = async (files: readonly File[]) => {
    const { accepted } = readBtwImages(files, images.length);
    const next = await Promise.all(accepted.map(fileToBtwImage));
    setImages((current) => [...current, ...next]);
  };
  const sendFollowUp = () => {
    if (!thread || pending || (!thread.draft.trim() && !images.length)) return;
    model.send(thread.id, false, images);
    setImages([]);
  };
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = { x: event.clientX, width };
  };
  const composerValue = thread ? thread.draft : state.question;
  const composerSet = thread ? (value: string) => model.setDraft(thread.id, value) : model.setQuestion;
  const composerSubmit = thread ? sendFollowUp : submitQuestion;
  // Context acquisition is asynchronous and must not disable the composer.
  // submit() keeps the draft and joins the in-flight context request.
  const composerDisabled = thread ? pending || (!thread.draft.trim() && !images.length) : (!state.question.trim() && !images.length);

  return (
    <section
      className="btw-drawer"
      data-btw-drawer="true"
      data-collapsed={collapsed ? "true" : "false"}
      aria-label={t("terminal.btw.title")}
      style={{ ...panelStyle, width: collapsed ? 160 : width }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (pending && thread) model.stop(thread.id);
          else setCollapsed(true);
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === "w") {
          event.preventDefault();
          onClose();
        }
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
          {onBackHistory ? <Button size="sm" variant="ghost" data-btw-drawer-action="history" onClick={onBackHistory}>{t("terminal.btw.backToHistory")}</Button> : null}
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
                <p key={`q-${index}`} className="btw-drawer-question">{btwContentText(message.content)}{typeof message.content !== "string" && message.content.filter(part => part.type === "image").map((part, imageIndex) => <img key={imageIndex} src={`data:${part.source.media_type};base64,${part.source.data}`} alt={part.name ?? t("terminal.btw.attachedImage")} className="btw-message-image" />)}</p>
              ) : (
                <SessionTranscriptContent key={`a-${index}`} content={btwContentText(message.content)} variant="terminal"
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
            {showCommandHint ? <div className="btw-command-hint" role="status">
              <strong>{t("terminal.btw.commandHintTitle")}</strong>
              <span>{t("terminal.btw.commandHintBody")}</span>
            </div> : null}
            <BtwContextCapsule
              source={thread?.source ?? state.source}
              context={thread?.context ?? state.context}
              loading={thread?.contextLoading ?? state.contextLoading}
              inherited={thread?.inherit ?? state.inherit}
              quote={thread?.quote ?? state.quote}
              imageCount={images.length}
              onRefresh={thread ? () => { model.refreshContext(thread.id); } : undefined}
            />
            {images.length ? <div className="btw-image-previews">{images.map((image, index) => <div key={`${image.source.data.slice(0, 12)}-${index}`} className="btw-image-preview"><img src={`data:${image.source.media_type};base64,${image.source.data}`} alt={image.name ?? t("terminal.btw.attachedImage")} /><button type="button" aria-label={t("terminal.btw.removeImage")} title={t("terminal.btw.removeImage")} onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div> : null}
            <textarea
              ref={inputRef}
              className="btw-drawer-input"
              aria-label={thread ? t("terminal.btw.drawerFollowUp") : t("terminal.btw.questionLabel")}
              placeholder={thread ? t("terminal.btw.drawerFollowUp") : t("terminal.btw.drawerPlaceholder")}
              value={composerValue}
              onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void addImages(files); } }}
              onChange={(event) => {
                const value = event.target.value;
                composerSet(value);
                setShowCommandHint(value.trimStart().startsWith("/"));
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                event.preventDefault();
                if (!composerDisabled) composerSubmit();
              }}
            />
            <div className="btw-drawer-composer-toolbar">
              <div className="btw-drawer-attach"><input ref={imageInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { void addImages(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} /><Button size="sm" variant="ghost" aria-label={t("terminal.btw.attachImage")} title={t("terminal.btw.attachImage")} onClick={() => imageInputRef.current?.click()}><Image size={14} aria-hidden="true" />{t("terminal.btw.attachImage")}</Button></div>
              <Button size="sm" variant="default" data-btw-drawer-action="submit" disabled={composerDisabled} onClick={composerSubmit}>
                {t("terminal.btw.ask")}
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
