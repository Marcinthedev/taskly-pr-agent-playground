# PR Test Agent

For every pull request that changes `backend/src/**` or `frontend/src/**`, a Claude Code agent writes or updates unit tests for the changed code. The workflow then verifies the tests, commits them to the PR branch and reports the result in one PR comment.

The same agent and skills were also used to add missing tests to the existing app:

| Area | Tests | Line coverage |
| --- | --- | --- |
| Backend | 58 → 107 | 55.6% → 93.7% |
| Frontend | 23 → 83 | 55.3% → 97.5% |

## 1. Technical decisions and rationale

- **Claude Code as the agent environment, via `anthropics/claude-code-action`.** It is a real tool-using loop: the agent reads code, writes tests, runs them and fixes them. A single "return a diff" model call can't do that. Agents and skills are plain Markdown files that also work locally in Claude Code.
- **The workflow decides, the agent proposes.** Planning, policy, verification and reporting are deterministic code with their own tests. Every pass/fail and coverage number in the PR comes from the workflow's own run, not from the agent's claims.
- **Defence in depth on what the agent can do:**
  - Tool allowlist: no web access, and Bash is limited to the test runner and read-only git.
  - A guard discards the run if anything other than test files changed.
  - The patch is re-checked before it is committed.
  - Agent configuration and tooling always come from the base branch, so a PR can't weaken its own checks.
- **Sandboxed execution.** Dependency installs and all test runs execute as a separate OS user, with an empty environment and no network.
- **Split trust.** The trigger is `pull_request`, not `pull_request_target`. The job that runs PR code has a read-only token. The job with write access never runs PR code.
- **Commit to the PR branch.** The tests appear in the same PR, where the author reviews them before merging.

## 2. Running the PR workflow

**Prerequisites**
1. This code on the repository's default branch.
2. A repository secret: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, Claude Pro or Max) or `ANTHROPIC_API_KEY`.
3. Optional variables: `PR_AGENT_MODEL` (default `claude-sonnet-5-5`), and `PR_AGENT_AUTO_COMMIT=false` for a patch artifact instead of a commit.

**Trigger:** open or update a non-draft PR, from a branch in the same repository, that changes app source.

**Results in the PR:**
- one comment, updated in place, also copied to the job summary
- a `pr-agent-results` artifact with the raw plan, decision, guard, test and coverage files
- a check that turns red when the agent's tests are rejected

## 3. Where the agent and skills are defined and how they are used

| Piece | Location | Role during a run |
| --- | --- | --- |
| Custom agent | [.claude/agents/test-engineer.md](.claude/agents/test-engineer.md) | Analyse → write → verify → report, ending in a fixed JSON report |
| `pr-change-analysis` skill | [.claude/skills/](.claude/skills) | Decides per changed file: write, update or skip, with a reason |
| `backend-unit-tests`, `frontend-unit-tests` skills | same | This repo's test conventions and seams (fakes, mocks, fixtures) |
| `test-verification` skill | same | Red/green loop, and what counts as a valid green |
| Workflow | [.github/workflows/pr-test-agent.yml](.github/workflows/pr-test-agent.yml) | Orchestration and trust boundaries |
| Tooling | [scripts/pr-agent/](scripts/pr-agent) | Plan, guard, sandboxed test runner, report (36 tests) |

**A run, step by step:**
1. **Plan:** each changed source file is mapped to its test file.
2. **Agent:** the agent loads the skills, writes tests, and runs them through the sandboxed runner until they pass.
3. **Guard:** only test files may have changed.
4. **Verify:** the workflow re-runs typecheck and the full suites with coverage.
5. **Publish:** commit to the PR branch and update the comment.

## 4. Example run

The example PR, branch `demo/clear-completed-tasks`, adds a "Clear completed tasks" feature without tests: a backend route and repository method, plus a frontend API call, a mutation hook, a header button and page wiring. It also breaks two existing tests, so the agent must both repair and add tests.

The planner's actual output for this PR:
- **Targets:** `repository.ts`, `router.ts`, `TodosPage.tsx`, `todos.ts`, `TodosHeader.tsx`, and two files with no tests yet, `useClearCompletedMutation.ts` and `queryKeys.ts`.
- **Ignored:** `openapi.json` (not source) and `types.ts` (type-only).

*Agent decisions, skills used, test files written and the verification table: to be copied from the PR comment.*

## 5. Assumptions

- PRs come from branches in the same repository. Their authors are trusted to run code in CI, as normal CI already allows.
- Unit tests use the existing stack (Vitest with supertest or Testing Library) and need no database or network.
- One test file per source module is the right default. The agent may pick another file when it has a reason.

## 6. Limitations and failure scenarios

**Result quality: green does not mean useful.**

| Scenario | What the solution does | What remains |
| --- | --- | --- |
| Weak or tautological tests | Skills require literal expected values and full-strength matchers | Not detected automatically. Needs human review |
| A bug written down as expected behaviour | The verification skill says to report suspected bugs, not assert them | The agent can still misjudge which behaviour is intended |
| An existing test weakened or deleted to get green | Deletions are blocked, and the diff is visible in the PR | Edits that remove assertions are allowed and not flagged |
| A wrong "no tests needed" decision | The decision and its reason are shown in the comment | Nothing checks coverage of the changed lines |
| Flaky tests (time, order) | Skills require fake timers and fakes for IO | Each test runs only once during verification |

**Reliability**

| Scenario | What the solution does |
| --- | --- |
| Model outage, rate limit, turn or time limit hit | The run fails cleanly with a red check and a reason. Normal CI is unaffected. Push again to retry |
| Agent returns no report or a malformed one | Treated as a failure, never as a skip |
| Partial edits when a limit is hit | Guard and verification still apply. Only green, test-only changes are committed |
| The branch moved during the run | The commit is refused, and the next push regenerates the tests |
| Two pushes in quick succession | The older run is cancelled |
| A large PR | The diff is capped at 400 KB. Many targets can exhaust the turn limit |

Problems found and fixed during the first real runs: the sandbox user couldn't read the checkout, the two users couldn't share the coverage folder, and GitHub sometimes reports a stale base commit.

**Security**

| Threat | Control |
| --- | --- |
| Prompt injection through PR content | No web tools. Bash limited to the test runner. Edits outside tests are denied and caught by the guard |
| A malicious test trying to steal the model key | Tests run as another OS user, with an empty environment and no network, so they can't reach the key |
| Test code tampering with results or approved files | The results folder is private to the main runner user. The patch is cut before verification and compared after |
| A PR weakening its own checks | Agent config and tooling are loaded from the base branch |
| Fork PRs, or write access next to PR code | `pull_request` only. Fork PRs are skipped. The write token never runs PR code |
| Supply chain | Actions pinned to commit SHAs. Dependencies installed from the lockfile, inside the sandbox |
| Loops and cost | Bot commits don't trigger runs. Each run is capped at 80 turns and 25 minutes |

**Known gaps**
- The agent process itself holds the model credential. Its file-read tool isn't explicitly denied access to `/proc` or the home folder, so an injected instruction could, in theory, copy the token into a test file that then gets committed.
- The agent's commit doesn't retrigger CI, because pushes made with `GITHUB_TOKEN` never do.

## 7. What I would change for production

- **Close the credential gap:**
  - deny the agent's read tool access to `/proc` and the home folder
  - scan the patch for secret patterns before committing
  - use workload identity federation instead of a static token
- **Prove the tests are useful:**
  - run the new tests against the base version of the source; they should fail there and pass on the PR
  - report coverage of the changed lines
  - flag removed assertions
  - re-run new tests 3 times to catch flakiness
- **Reliability:** one automatic retry when the model is unavailable, and a GitHub App token so the agent's commit retriggers CI.
- **Explicit approval:** optionally open a separate "tests for #N" PR instead of committing to the author's branch.
- **Reuse:** a per-repo config file listing code areas, test locations and commands, so other repositories can use the agent without code changes.
- **Quality over time:** an evaluation set of recorded PRs with expected decisions, re-run on every skill change, plus mutation testing on changed files.
