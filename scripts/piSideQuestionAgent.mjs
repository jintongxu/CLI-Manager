import readline from "node:readline";
import * as sdk from "@earendil-works/pi-coding-agent";
import { handleRequest } from "./piSideQuestionAgentCore.mjs";

const write = (message) => new Promise((resolve, reject) => {
  process.stdout.write(`${JSON.stringify(message)}\n`, (error) => error ? reject(error) : resolve());
});
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let request;
  let pending = Promise.resolve();
  try {
    request = JSON.parse(line);
    const result = await handleRequest(request, sdk, (message) => {
      pending = pending.then(() => write(message));
    });
    await pending;
    await write(result);
  } catch (error) {
    await pending.catch(() => {});
    // Never expose provider errors, raw requests, source text, paths or credentials.
    // Keep a stable diagnostic class so the host can distinguish configuration
    // failures from protocol/runtime failures without leaking provider details.
    const message = String(error?.message ?? error ?? "");
    const errorCode = /api.?key|unauthori[sz]ed|\b401\b|\b403\b/i.test(message)
      ? "side_question_provider_auth"
      : /model|provider|unsupported|vision/i.test(message)
        ? "side_question_provider_config"
        : "side_question_failed";
    await write({ type: "error", requestId: request?.requestId, error: errorCode });
    process.exitCode = 1;
  }
  if (request?.type !== "ping") {
    rl.close();
    // SDK providers can retain network handles. Output is flushed and the session disposed first.
    process.exit(process.exitCode ?? 0);
  }
}
