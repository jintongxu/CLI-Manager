import React, { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { BtwTerminalDrawer } from "../../src/features/terminal/components/BtwTerminalDrawer";
import { BtwThreadModel } from "../../src/features/terminal/lib/btwThreadModel";
import type { BtwSideQuestionController } from "../../src/features/terminal/hooks/useBtwSideQuestion";

declare global { interface Window { __btw: BtwThreadModel; __btwClosed: boolean } }
import "../../src/App.css";

// Real drawer + real model + production CSS; only the transport and host geometry are fixture-owned.
let progress: ((event: { requestId: string; threadId: string; text: string }) => void) | null = null;
const model = new BtwThreadModel({
  context: async () => ({ available: true, text: "context", truncated: false, reason: null }),
  ask: ({ requestId, threadId, messages }) => new Promise<string>((resolve) => {
    const words = "streaming answer chunk".split(" ");
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      progress?.({ requestId, threadId, text: words.slice(0, index).join(" ") });
      if (index >= words.length) {
        clearInterval(timer);
        resolve(`${words.join(" ")}\n\n\`\`\`js\nconst value = 42;\n\`\`\``);
      }
    }, 20);
    void messages;
  }),
  cancel: async () => {},
  listen: async (callback) => { progress = callback; return () => { progress = null; }; },
});
model.stage("quoted terminal line 1\nquoted terminal line 2", { terminalId: "term-1", sessionId: "sess-1", reason: null });

function Harness() {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const controller: BtwSideQuestionController = {
    state, model,
    stageFromTerminal: (quote, terminalId = "term-1") => model.stage(quote, { terminalId, sessionId: "sess-1", reason: null }),
    setQuestion: model.setQuestion,
    submit: model.submit,
    clear: model.clear,
  };
  return <div className="btw-terminal-split" style={{ height: 560, width: "100%", background: "var(--bg-primary, #111)" }}>
    <div style={{ flex: 1, minWidth: 0, padding: 12, fontFamily: "monospace", opacity: 0.6 }}>
      {Array.from({ length: 18 }, (_, index) => <div key={index}>terminal output line {index + 1}</div>)}
    </div>
    <div className="btw-terminal-split-pane"><BtwTerminalDrawer controller={controller} onClose={() => { window.__btwClosed = true; }} /></div>
  </div>;
}

window.__btw = model;
createRoot(document.getElementById("root")!).render(<Harness />);
