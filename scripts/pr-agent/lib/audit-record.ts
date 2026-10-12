import type { AgentReport, AgentUsage } from "./agent-result.ts";
import type { ChangePlan } from "./change-plan.ts";
import type { PolicyName, PolicyResult } from "./change-policy.ts";
import type { AreaVerification, Outcome } from "./pr-comment.ts";

export interface AuditContext {
  timestamp: string;
  repository: string;
  runUrl: string;
  actor: string;
  event: string;
  pr: number;
  baseRef: string;
  headSha: string;
  mode: PolicyName;
  model: string;
  maxTurns: number;
  timeoutMinutes: number;
}

export interface AuditInput {
  context: AuditContext;
  plan: Pick<ChangePlan, "targets"> | null;
  decision: AgentReport | null;
  guard: PolicyResult | null;
  verification: Record<string, AreaVerification>;
  usage: AgentUsage | null;
  outcome: Outcome;
}

export function buildAuditRecord({ context, plan, decision, guard, verification, usage, outcome }: AuditInput) {
  return {
    schemaVersion: 1,
    ...context,
    changedSources: plan?.targets.map((target) => target.source) ?? [],
    decision: decision?.decision ?? null,
    skillsUsed: decision?.skills_used ?? [],
    filesAllowed: guard?.allowed ?? [],
    violations: guard?.violations ?? [],
    verification: Object.fromEntries(
      Object.entries(verification).map(([area, result]) => [
        area,
        {
          typecheck: result.typecheck,
          format: result.format,
          testsPassed: result.tests?.passed ?? null,
          testsTotal: result.tests?.total ?? null,
          linesBefore: result.linesBefore,
          linesAfter: result.linesAfter,
        },
      ]),
    ),
    usage,
    outcome: { status: outcome.status, reason: outcome.reason ?? "", commit: outcome.sha || null },
  };
}
