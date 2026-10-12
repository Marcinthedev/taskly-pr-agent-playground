const REPORTED_DECISIONS = [
  "tests_added",
  "tests_updated",
  "no_tests_needed",
  "refactored",
  "no_refactor_needed",
  "abstained",
];

export interface AgentReport {
  decision: string;
  summary: string;
  skills_used: string[];
  files: { path: string; action: string; covers?: string }[];
  skipped: { source: string; reason: string }[];
}

export interface AgentUsage {
  costUsd: number | null;
  turns: number | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheWriteTokens: number | null;
  cacheReadTokens: number | null;
}

type Entry = Record<string, unknown>;

const isRecord = (value: unknown): value is Entry => typeof value === "object" && value !== null;
const isString = (value: unknown): value is string => typeof value === "string";
const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function resultEntry(log: unknown): Entry | undefined {
  return Array.isArray(log) ? log.findLast((entry): entry is Entry => isRecord(entry) && entry.type === "result") : undefined;
}

export function finalResultText(log: unknown): string {
  const text = resultEntry(log)?.result;
  return isString(text) ? text : "";
}

export function parseAgentReport(text: string): AgentReport | null {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)\n\s*```/g)];
  const last = blocks.at(-1);
  if (!last) return null;

  let value: unknown;
  try {
    value = JSON.parse(last[1]);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  const report = {
    decision: value.decision,
    summary: value.summary ?? "",
    skills_used: value.skills_used ?? [],
    files: value.files ?? [],
    skipped: value.skipped ?? [],
  };
  const valid =
    isString(report.decision) &&
    REPORTED_DECISIONS.includes(report.decision) &&
    isString(report.summary) &&
    Array.isArray(report.skills_used) && report.skills_used.every(isString) &&
    Array.isArray(report.files) &&
    report.files.every((file) => isRecord(file) && isString(file.path) && isString(file.action) && isString(file.covers ?? "")) &&
    Array.isArray(report.skipped) &&
    report.skipped.every((entry) => isRecord(entry) && isString(entry.source) && isString(entry.reason));
  return valid ? (report as AgentReport) : null;
}

export function agentUsage(log: unknown): AgentUsage | null {
  const result = resultEntry(log);
  if (!result || !Array.isArray(log)) return null;

  const models = isRecord(result.modelUsage) ? Object.values(result.modelUsage).filter(isRecord) : [];
  const sum = (field: string) => (models.length ? models.reduce((total, model) => total + (finite(model[field]) ?? 0), 0) : null);
  const usage = isRecord(result.usage) ? result.usage : {};

  const assistantTurns = log.filter((entry) => isRecord(entry) && entry.type === "assistant").length;
  const turns = Math.max(finite(result.num_turns) ?? 0, assistantTurns);

  return {
    costUsd: finite(result.total_cost_usd),
    turns: turns || null,
    durationMs: finite(result.duration_ms),
    inputTokens: sum("inputTokens") ?? finite(usage.input_tokens),
    outputTokens: sum("outputTokens") ?? finite(usage.output_tokens),
    cacheWriteTokens: sum("cacheCreationInputTokens") ?? finite(usage.cache_creation_input_tokens),
    cacheReadTokens: sum("cacheReadInputTokens") ?? finite(usage.cache_read_input_tokens),
  };
}
