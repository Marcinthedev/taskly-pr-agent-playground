# PR Test Agent

- **What it does:** when a pull request changes `backend/src` or `frontend/src`, a Claude Code agent (the **test-engineer**) writes or updates unit tests for the changed code.
- **Who checks it:** a GitHub Actions workflow checks the tests, runs them, commits them to the PR branch and posts the results as a PR comment.
- **Coverage first:** I used the same agent and skills to fill the gaps in the existing test suite:

  | Area | Tests | Line coverage |
  | --- | --- | --- |
  | Backend | 58 → 107 | 55.6% → 93.7% |
  | Frontend | 23 → 83 | 55.3% → 97.5% |

- **Bugs found on the way:** writing those tests uncovered four small bugs, all fixed.
- **Extras:** things I built for fun are listed in [SOLUTION_EXTENDED.md](SOLUTION_EXTENDED.md).

## How it works

```mermaid
flowchart TD
    A["PR opened or updated<br/>changes backend/src or frontend/src"] --> B{"Same repo, not a draft,<br/>user allowed?"}
    B -- no --> SKIP["Skip notice, no tokens spent"]
    B -- yes --> C["Plan: map changed files<br/>to their test files"]
    C --> D{"Anything to test?"}
    D -- no --> REPORT
    D -- yes --> E["Sandbox: install dependencies as a separate user,<br/>cut its network, measure coverage before"]
    E --> F["Agent: test-engineer loads its skills,<br/>writes tests, runs and fixes them until green"]
    F --> G{"Guard: only test files changed?"}
    G -- no --> REJECT["Rejected: changes discarded, check turns red"]
    G -- yes --> H{"Verify: typecheck, Prettier,<br/>full test suites with coverage"}
    H -- fails --> REJECT
    H -- passes --> I["Publish: re-check the patch,<br/>commit tests to the PR branch"]
    I --> REPORT["PR comment and audit record"]
    REJECT --> REPORT

    subgraph readonly ["Read-only job: runs PR code, no write access"]
        C
        D
        E
        F
        G
        H
    end
    subgraph write ["Write job: never runs PR code"]
        I
        REPORT
    end
```

## 1. Main technical decisions

- **Claude Code as the agent environment**
  - Runs through the official `anthropics/claude-code-action`, pinned to a commit.
  - The agent works in a loop: it reads the code, writes a test, runs it, reads the failure and fixes it. A single model call that returns a diff can't check its own work.
  - Agents and skills are plain Markdown files, so the same setup works locally too.
- **The agent proposes, the workflow decides**
  - Everything around the agent is ordinary, tested TypeScript in [scripts/pr-agent](scripts/pr-agent): planning, policy checks, verification, reporting.
  - All pass/fail and coverage numbers in the PR come from the workflow's own run, not from the agent.
- **Security in layers**, because the agent reads untrusted PR content:
  - **Limited tools:** no web access. The shell is limited to the test runner, the formatter and read-only git. Reading `/proc` and the runner's dotfiles is denied.
  - **Guard:** the run is discarded if anything other than test files changed, and the patch is checked again before it's committed.
  - **Rules from the base branch:** agent instructions, permissions and checking code always come from the base branch, so a PR can't loosen them.
  - **Sandbox:** installs and tests run as a separate Linux user, with no secrets and no network.
  - **Write access kept apart:** the trigger is `pull_request`. The job that runs PR code is read-only, and the job that pushes never runs PR code.
  - **Allowlist:** only listed users (by default the owner) can start the agent. Everyone else, bots included, is skipped.
- **Delivery:** tests are committed to the PR branch. The agent only touches test files, and you review them in the same PR before merging.
- **Standards:** generated tests must pass the strict typecheck and Prettier, and follow the nine quality rules in section 3. Anything else is rejected.
- **Bounded and traceable runs:**
  - capped at 40 turns and 15 minutes
  - tokens and estimated cost reported in the PR comment and the commit message
  - an audit record for every run

## 2. How to run the PR workflow

**Prerequisites**
1. This code on the repository's default branch.
2. A repository secret with the model credential:
   - `CLAUDE_CODE_OAUTH_TOKEN`, from `claude setup-token` with a Claude Pro or Max plan, or
   - `ANTHROPIC_API_KEY`.

**Optional repository variables**

| Variable | Default | Purpose |
| --- | --- | --- |
| `PR_AGENT_ALLOWED_USERS` | the repository owner | GitHub logins allowed to start the agent, comma-separated |
| `PR_AGENT_MODEL` | `claude-sonnet-5-5` | The model the agent runs on |
| `PR_AGENT_MAX_TURNS` | `40` | The agent's turn limit |
| `PR_AGENT_TIMEOUT_MINUTES` | `15` | The agent's time limit |
| `PR_AGENT_AUTO_COMMIT` | `true` | `false` gives a patch file instead of a commit |
| `PR_AGENT_KEEP_TRANSCRIPT` | `false` | `true` keeps the agent's full transcript for 14 days. Best on private repositories |

**Trigger:** open or update a non-draft PR, from a branch in the same repository, that changes app source.

**What every run leaves**
- **PR comment,** updated in place: the decision, the skills used, the test files, a typecheck, format, tests and coverage table, and the usage.
- **Commit** with the verified tests, or a red check explaining why there isn't one.
- **`pr-agent-results` artifact** with the raw files, kept 14 days.
- **`pr-agent-audit` artifact,** kept 90 days: who ran it, on which commits, with which model and limits, what changed, the verification result, the cost and the outcome.

## 3. Where the agent and skills are defined, and how they're used

| What | Where | Role in a run |
| --- | --- | --- |
| `test-engineer` agent | [.claude/agents/test-engineer.md](.claude/agents/test-engineer.md) | Analyses the change, writes tests, verifies them, and reports in a fixed JSON format |
| `pr-change-analysis` skill | [.claude/skills/pr-change-analysis](.claude/skills/pr-change-analysis/SKILL.md) | Decides for each changed file whether to write a test, update one or skip it, and why |
| `unit-test-quality` skill | [.claude/skills/unit-test-quality](.claude/skills/unit-test-quality/SKILL.md) | What a good unit test is |
| `backend-unit-tests` skill | [.claude/skills/backend-unit-tests](.claude/skills/backend-unit-tests/SKILL.md) | This repo's backend test conventions: what to fake and how |
| `frontend-unit-tests` skill | [.claude/skills/frontend-unit-tests](.claude/skills/frontend-unit-tests/SKILL.md) | This repo's frontend test conventions: what to mock and how |
| `test-verification` skill | [.claude/skills/test-verification](.claude/skills/test-verification/SKILL.md) | The run-fix-repeat loop, formatting and typecheck |
| Workflow | [.github/workflows/pr-agents.yml](.github/workflows/pr-agents.yml) | Runs everything and enforces the boundaries |
| Tooling | [scripts/pr-agent/](scripts/pr-agent) | Planner, guard, sandboxed runner, report and audit record. A separate TypeScript package with its own tests |

**A run, step by step** (the graph above):
1. **Plan:** map each changed source file to its test file, skipping files with nothing to test.
2. **Agent:** load the skills, write the tests, run them until they're green.
3. **Guard:** only test files may have changed.
4. **Verify:** run the typecheck, Prettier and the full suites with coverage again.
5. **Publish:** commit the tests, update the comment, write the audit record.

**A good unit test,** as defined by the `unit-test-quality` skill:
1. checks one behaviour, and its name says which
2. uses the public interface only
3. fails if the code it checks breaks
4. compares against fixed expected values, with strict matchers
5. covers the edge cases
6. only fakes the outside world: network, database, clock
7. is isolated and deterministic
8. is readable, with no logic and nothing skipped
9. passes the typecheck and the formatter without `@ts-ignore` or `as any`

## 4. Example run

**The PR:** [PR #2](https://github.com/Marcinthedev/taskly-pr-agent-playground/pull/2) adds a "Clear completed tasks" feature with no tests:
- **Backend:** a route and a repository method.
- **Frontend:** an API call, a mutation hook, a header button and the page wiring.
- **Breakage:** it also breaks two existing tests on purpose.

**What happened**
- **Plan:** 7 changed files mapped to their test files. `openapi.json` and `types.ts` ignored.
- **Agent decision:** `tests_added`.
- **Skills used:** `pr-change-analysis`, `unit-test-quality`, `backend-unit-tests`, `frontend-unit-tests`, `test-verification`.
- **Tests written:** 7 files and 242 lines, committed as `f0f1ddb`.
  - **Repaired:** the router test's fake and the page test's missing mock.
  - **New route:** 200 with `{ deleted }`, not routed as an id, 500 on failure.
  - **Everything else:** the repository query, the API call, the hook's cache update, the header button's states, and the page's notices and guards.

**Verification by the workflow**

| Area | Typecheck | Tests | Line coverage |
| --- | --- | --- | --- |
| backend | ✅ | 114 / 114 passed | 92.5% → 93.8% |
| frontend | ✅ | 100 / 100 passed | 83.1% → 97.8% |

**Notes**
- The frontend's low starting coverage comes from the two tests the feature broke.
- **Lessons fed back into the agent:**
  - The agent tested a constants file by restating the constant, so the planner now skips constants files.
  - The usage line only counted the coordinating agent, so it now counts all of them.

## 5. Assumptions

- PRs come from branches in the same repository, and their authors are trusted to run code in CI.
- Tests use the existing stack (Vitest, supertest, Testing Library) and need no database or network.
- One test file per source file is a sensible default.

## 6. Limitations

- **Passing doesn't mean useful.** The quality rules make weak tests less likely, but only a human review catches them for sure.
- **No coverage gate on changed lines.** If the agent wrongly decides a change needs no tests, nothing flags it.
- **Fork PRs are skipped,** because they get no secrets.
- **Large PRs** can hit the turn or time limit. The run then fails cleanly, and normal CI isn't affected.
- **No secret scan.** The patch isn't scanned for secrets before it's committed.

## 7. What I'd change for production

- **Prove the tests matter:**
  - run each new test against the code before the change, where it should fail
  - a coverage gate on changed lines
  - mutation testing
- **Credentials:**
  - scan each patch for secrets
  - replace the static token with short-lived credentials (workload identity federation)
- **Spend fewer tokens:**
  - only look at commits since the last run
  - skip trivial changes and already-covered lines
  - give the agent the context it needs up front, instead of letting it search
- **Improve testability, not just tests:** some code is hard to test because of how it's written. I built a second agent for this. It pulls logic out into small, pure functions and opens the result as a separate PR. It's switched off for now; see [SOLUTION_EXTENDED.md](SOLUTION_EXTENDED.md).
- **Reuse and observability:**
  - a per-repo config file, so other projects can use the agent without code changes
  - audit records sent to a central log store
