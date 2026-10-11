# PR Test Agent

For every pull request that changes `backend/src/**` or `frontend/src/**`, a Claude Code agent, the **test-engineer**, writes or updates unit tests for the changed code. The workflow then verifies the tests, commits them to the PR branch and reports the result in one PR comment.

The same agent and skills were also used to add missing tests to the existing app:

| Area | Tests | Line coverage |
| --- | --- | --- |
| Backend | 58 → 107 | 55.6% → 93.7% |
| Frontend | 23 → 83 | 55.3% → 97.5% |

Extensions beyond the task, a testability-refactoring agent and a local pre-push hook, are described in [SOLUTION_EXTENDED.md](SOLUTION_EXTENDED.md).

## 1. Technical decisions and rationale

- **Claude Code as the agent environment, via `anthropics/claude-code-action`.** It is a real tool-using loop: the agent reads code, writes tests, runs them and fixes them. A single "return a diff" model call can't do that. Agents and skills are plain Markdown files that also work locally in Claude Code.
- **The workflow decides, the agent proposes.** Planning, policy, verification and reporting are deterministic code with their own tests. Every pass/fail, format and coverage number in the PR comes from the workflow's own run, not from the agent's claims.
- **Defence in depth on what the agent can do:**
  - Tool allowlist: no web access, and Bash limited to the test runner, the formatter and read-only git.
  - Reads of `/proc` and the runner's dotfiles are denied.
  - A guard discards the run if anything other than test files changed.
  - The patch is re-checked before it is committed.
  - Agent configuration and tooling always come from the base branch, so a PR can't weaken its own checks.
- **Sandboxed execution.** Dependency installs and all test runs execute as a separate OS user, with an empty environment and no network.
- **Split trust.** The trigger is `pull_request`, not `pull_request_target`. The job that runs PR code has a read-only token. The job with write access never runs PR code.
- **Commit to the PR branch.** The agent changes test files only, so the risk is low, and the author reviews the tests in the same PR before merging. A separate "tests for #N" PR would add a step without adding safety.
- **Generated tests meet the repo's standards.** Strict typecheck, Prettier for frontend tests, and the nine-rule quality definition below. Unformatted or untyped output is rejected, not committed.

## 2. Running the PR workflow

**Prerequisites**
1. This code on the repository's default branch.
2. A repository secret: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, Claude Pro or Max) or `ANTHROPIC_API_KEY`.
3. Optional variables:
   - `PR_AGENT_ALLOWED_USERS`: GitHub logins allowed to trigger the agent, comma-separated with no spaces. Unset means only the repository owner.
   - `PR_AGENT_MODEL`: defaults to `claude-sonnet-5-5`.
   - `PR_AGENT_AUTO_COMMIT=false`: tests as a patch artifact instead of a commit.

**Trigger:** an allowed user opens or updates a non-draft PR, from a branch in the same repository, that changes app source.

**Results in the PR:**
- one comment, updated in place, also copied to the job summary
- a verification table: typecheck, format, tests, and coverage before and after
- the agent's usage: turns, tokens, estimated cost and duration. It also goes into the agent's commit message
- a `pr-agent-results` artifact with the raw plan, decision, guard, test and coverage files
- a check that turns red when the agent's tests are rejected

## 3. Where the agent and skills are defined and how they are used

| Piece | Location | Role during a run |
| --- | --- | --- |
| `test-engineer` agent | [.claude/agents/test-engineer.md](.claude/agents/test-engineer.md) | Analyse → write tests → verify → report, ending in a fixed JSON report |
| `pr-change-analysis` skill | [.claude/skills/](.claude/skills) | Per changed file: write, update or skip a test, with a reason |
| `unit-test-quality` skill | same | The definition of a well-constructed unit test |
| `backend-unit-tests`, `frontend-unit-tests` skills | same | This repo's test conventions and seams |
| `test-verification` skill | same | Red/green loop, formatting, typecheck, and what counts as a valid green |
| Workflow | [.github/workflows/pr-test-agent.yml](.github/workflows/pr-test-agent.yml) | Orchestration and trust boundaries |
| Tooling | [scripts/pr-agent/](scripts/pr-agent) | Plan, guard, sandboxed runner, formatter, report, usage (53 tests) |

**A run, step by step:**
1. **Plan:** each changed source file is mapped to its test file. Files with nothing to test are ignored with a reason: types, constants, styles, entry points.
2. **Agent:** loads the skills, writes tests, and runs them, the typecheck and the formatter through the sandboxed runner until all are green.
3. **Guard:** only test files may have changed.
4. **Verify:** the workflow itself re-runs typecheck, the formatting check and the full suites with coverage.
5. **Publish:** commit to the PR branch and update the comment.

**What counts as a well-constructed unit test.** The rule is defined once, in [`unit-test-quality`](.claude/skills/unit-test-quality/SKILL.md). Every test the agent writes must meet it. A test:
1. proves one behaviour, and its name reads as a specification
2. goes through the public interface only
3. fails for the right reason: removing the source line it relies on turns it red
4. uses expected values that are independent literals, with strict matchers
5. covers the edges (boundaries, invalid input, error and empty states), not just the happy path
6. fakes only at input and output boundaries
7. is isolated and deterministic
8. reads as arrange, act, assert, with no logic and nothing skipped
9. is typed and formatted like production code: strict typecheck, no `@ts-ignore` or `as any` to silence errors, Prettier for frontend tests

The tests added to the existing app (the coverage table above) were written to these principles, and the rule now makes them explicit for the agent.

## 4. Example run

**PR:** branch `demo/clear-completed-v2`. It adds a "Clear completed tasks" feature without tests: a backend route and repository method, plus a frontend API call, a mutation hook, a header button and page wiring. The feature also breaks two existing tests, a typed fake and an unmocked hook, so CI is red on the feature commit.

**What happened:**
- **Plan:** 7 targets across backend and frontend. `openapi.json` and `types.ts` were ignored.
- **Agent:** the test-engineer committed `f0f1ddb` as `github-actions[bot]`, with 7 test files and +242 lines:
  - **repaired:** `router.test.ts` (the fake store gained the new method) and `TodosPage.test.tsx` (the new hook mocked, plus clear-completed flows)
  - **extended:** `repository.test.ts`, `todos.test.ts` and `TodosHeader.test.tsx`
  - **created:** `useClearCompletedMutation.test.ts` and `queryKeys.test.ts`
- **Verification and CI:** green on the bot's commit. Its agent check correctly shows as skipped, because bot commits never run the agent.
- **Lessons fed back into the agent:**
  - **Constants test:** `queryKeys.test.ts` checks that the new key sits under the `todos` prefix. That invariant is real, because the page's busy state depends on it. But the test restates the constant instead of exercising the behaviour, against rules 2 and 4. The planner now skips constants files, so the invariant gets tested where it matters: the page is busy while clearing.
  - **Usage numbers:** the usage line in that commit counted only the coordinating agent. Usage now includes subagent work.

*Agent decision, skills used and verification table: copy from the PR comment.*

## 5. Assumptions

- PRs come from branches in the same repository. Their authors are trusted to run code in CI, as normal CI already allows.
- Unit tests use the existing stack (Vitest with supertest or Testing Library) and need no database or network.
- One test file per source module is the right default. The agent may pick another file when it has a reason.

## 6. Limitations and failure scenarios

**Result quality: green does not mean useful.**

| Scenario | What the solution does | What remains |
| --- | --- | --- |
| Weak or tautological tests | Quality rules 3 and 4, and constants files skipped by the planner | Not detected automatically. Needs human review |
| A bug written down as expected behaviour | The verification skill says to report suspected bugs, not assert them | The agent can still misjudge which behaviour is intended |
| An existing test weakened to get green | Deletions are blocked, and the diff is visible in the PR | Edits that remove assertions aren't flagged |
| A wrong "no tests needed" decision | The decision and its reason are shown in the comment | Nothing checks coverage of the changed lines |
| Flaky tests | Fake timers and fakes for IO are required | Each test runs only once during verification |

**Reliability**

| Scenario | What the solution does |
| --- | --- |
| Model outage, rate limit, turn or time limit hit | The run fails cleanly with a red check and a reason. Normal CI is unaffected |
| Agent returns no report or a malformed one | Treated as a failure, never as a skip |
| Partial or unformatted edits | Guard, formatting check and verification still apply. Only green, test-only changes are committed |
| The branch moved during the run | The commit is refused, and the next push regenerates the tests |
| Two pushes in quick succession | The older run is cancelled |
| A large PR | The diff is capped at 400 KB. Many targets can exhaust the turn limit |

Problems found and fixed during the first real runs:
- the sandbox user couldn't read the checkout
- the two users couldn't share the coverage folder
- GitHub sometimes reports a stale base commit
- usage counted only the coordinating agent

**Security**

| Threat | Control |
| --- | --- |
| Prompt injection through PR content | No web tools. Bash limited to the runner, the formatter and read-only git. Edits outside tests are denied and caught by the guard |
| A malicious test trying to steal the model key | Tests run as another OS user, with an empty environment and no network. The agent can't read `/proc` or the runner's dotfiles |
| Test code tampering with results or approved files | The results folder is private. The patch is cut before verification and compared after |
| A PR weakening its own checks | Agent config, permissions and tooling are loaded from the base branch |
| Someone else spending the model token | Only users in `PR_AGENT_ALLOWED_USERS` (default: the owner) trigger the agent. Others, bots included, get a skip notice |
| Fork PRs, or write access next to PR code | `pull_request` only. Fork PRs are skipped. The write token never runs PR code |
| Supply chain | Actions pinned to commit SHAs. Dependencies installed from the lockfile, inside the sandbox |
| Loops and cost | Bot-triggered runs are skipped. Each run is capped at 80 turns and 25 minutes |

**Known gap:** the patch isn't scanned for credentials before it is committed. That scan would be a last line of defence if a token ever reached a file.

## 7. What I would change for production

- **Credentials:** scan each patch for secret patterns before committing, and use workload identity federation instead of a static token.
- **Prove the tests are useful:**
  - run the new tests against the base version of the source; they should fail there and pass on the PR
  - report coverage of the changed lines
  - flag removed assertions
  - re-run new tests 3 times to catch flakiness
- **Reliability:** one automatic retry when the model is unavailable.
- **Fewer brittle fakes:** a shared typed fake per interface, and page tests that mock only the API layer, so interface changes stop breaking unrelated tests.
- **Reuse:** a per-repo config file listing code areas, test locations and commands, so other repositories can use the agent without code changes.
- **Quality over time:** an evaluation set of recorded PRs with expected decisions, re-run on every skill change, plus mutation testing on changed files.

**Spending fewer tokens.** Usage is already reported on every run, so each of these can be measured. In order of expected saving:
1. **Don't run when there's nothing to do:**
   - diff only the commits pushed since the last run, not the whole PR
   - skip whitespace-only and comment-only changes and renames before the agent starts
   - skip files whose changed lines are already covered by tests, using the baseline coverage the workflow already measures
   - optionally, trigger on "ready for review" or a `/test-agent` comment instead of every push
2. **Give the agent less to read.** The workflow pre-collects a context pack per file: the changed functions with surrounding code, the existing test, fixtures and types. That replaces exploratory searches and reads, which each cost a turn.
3. **Make each run smaller:**
   - run the agent directly instead of through a coordinating agent, which saves one context
   - lower the limits to about 30 turns and 2 fix attempts per file
   - use a small model to decide which files need tests, and a larger one only to write them
   - keep the agent definition and skills stable, so prompt caching applies

**Whole-codebase mode, as an alternative to PR mode.** A manually started or weekly workflow:
1. picks the N least-covered files from the coverage report
2. runs the same agent and skills on them under a fixed turn limit
3. opens one PR with the new tests for approval

The cost per run is fixed, and coverage rises a little each run.
