// Reads the agent's self-reported decision. The agent ends its run with a
// fenced json block; anything that does not match the contract is discarded
// and the report says so instead of guessing.
export const DECISIONS = ["tests_added", "tests_updated", "no_tests_needed", "abstained"];

const isString = (value) => typeof value === "string";
const isStringArray = (value) => Array.isArray(value) && value.every(isString);
const isFileEntry = (entry) => entry && isString(entry.path) && isString(entry.action) && isString(entry.covers ?? "");
const isSkipEntry = (entry) => entry && isString(entry.source) && isString(entry.reason);

export function extractDecision(text) {
  const blocks = [...String(text ?? "").matchAll(/```json\s*\n([\s\S]*?)\n\s*```/g)];
  const last = blocks.at(-1);
  if (!last) return null;

  let value;
  try {
    value = JSON.parse(last[1]);
  } catch {
    return null;
  }

  const decision = {
    decision: value?.decision,
    summary: value?.summary ?? "",
    skills_used: value?.skills_used ?? [],
    files: value?.files ?? [],
    skipped: value?.skipped ?? [],
  };
  const valid =
    DECISIONS.includes(decision.decision) &&
    isString(decision.summary) &&
    isStringArray(decision.skills_used) &&
    Array.isArray(decision.files) && decision.files.every(isFileEntry) &&
    Array.isArray(decision.skipped) && decision.skipped.every(isSkipEntry);
  return valid ? decision : null;
}

/** The final `result` text from claude-code-action's execution file. */
/**
 * Cost and size of the agent run, from the `result` entry Claude Code writes
 * at the end of its execution log. With a subscription token the cost is the
 * API-equivalent estimate Claude Code reports, not an invoice amount.
 */
export function agentUsage(log) {
  if (!Array.isArray(log)) return null;
  const result = log.findLast((message) => message?.type === "result");
  if (!result) return null;
  const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    costUsd: number(result.total_cost_usd),
    turns: number(result.num_turns),
    durationMs: number(result.duration_ms),
    inputTokens: number(result.usage?.input_tokens),
    outputTokens: number(result.usage?.output_tokens),
    cacheWriteTokens: number(result.usage?.cache_creation_input_tokens),
    cacheReadTokens: number(result.usage?.cache_read_input_tokens),
  };
}

export function finalAgentText(log) {
  if (!Array.isArray(log)) return "";
  const result = log.findLast((message) => message?.type === "result");
  return isString(result?.result) ? result.result : "";
}
