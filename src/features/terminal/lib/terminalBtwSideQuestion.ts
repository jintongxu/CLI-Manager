/** Project-owned prompt construction for isolated terminal side questions. */

export const SIDE_QUESTION_MARKER = "CLI_MANAGER_SIDE_QUESTION";
export const SIDE_QUESTION_MAX_LENGTH = 4000;
export const SIDE_QUESTION_HISTORY_MAX_LENGTH = 8000;
const SIDE_QUESTION_TRUNCATION_MARKER = "…";

export interface SideQuestionTurn {
  question: string;
  answer: string;
}

/** Build one safe Pi input line without relying on an upstream extension command. */
export function buildSideQuestionPrompt(question: string, quotedText = "", history: SideQuestionTurn[] = []): string | null {
  const singleLineQuestion = question.replace(/\s+/g, " ").trim();
  if (!singleLineQuestion) return null;
  const singleLineQuote = quotedText.replace(/\s+/g, " ").trim();
  const context = singleLineQuote.length > SIDE_QUESTION_MAX_LENGTH
    ? singleLineQuote.slice(0, SIDE_QUESTION_MAX_LENGTH) + SIDE_QUESTION_TRUNCATION_MARKER
    : singleLineQuote;
  const quoteSection = context ? ` Quoted terminal text: ${context}` : "";
  const historyText = history.map((turn) => `User: ${turn.question}\nAssistant: ${turn.answer}`).join("\n\n");
  const boundedHistory = historyText.length > SIDE_QUESTION_HISTORY_MAX_LENGTH
    ? `…${historyText.slice(-SIDE_QUESTION_HISTORY_MAX_LENGTH)}`
    : historyText;
  const historySection = boundedHistory ? ` Previous side-question conversation:\n${boundedHistory}\n` : "";
  return `${SIDE_QUESTION_MARKER}: Answer the user's question using the quoted terminal text when present and maintain continuity with the previous side-question conversation. Do not modify files, execute destructive actions, or write anything into the active terminal. Give a concise, self-contained explanation.\n${historySection}User question: ${singleLineQuestion}.${quoteSection}`;
}

/** Remove terminal control sequences and prompt echo while preserving the answer. */
export function extractSideQuestionAnswer(raw: string): string {
  const text = raw
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n?/g, "\n");
  const markerIndex = text.lastIndexOf(SIDE_QUESTION_MARKER);
  const candidate = markerIndex >= 0 ? text.slice(markerIndex + SIDE_QUESTION_MARKER.length) : text;
  return candidate.replace(/^[:\s]+/, "").replace(/^\n+/, "").replace(/\n+$/, "").trim();
}
