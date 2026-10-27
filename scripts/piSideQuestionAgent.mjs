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
  } catch {
    await pending.catch(() => {});
    // Never expose provider errors, raw requests, source text, paths or credentials.
    await write({ type: "error", requestId: request?.requestId, error: "side_question_failed" });
    process.exitCode = 1;
  }
  if (request?.type !== "ping") {
    rl.close();
    // SDK providers can retain network handles. Output is flushed and the session disposed first.
    process.exit(process.exitCode ?? 0);
  }
}
