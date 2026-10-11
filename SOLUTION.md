# PR Test Agent

For every pull request that changes `backend/src/**` or `frontend/src/**`, a Claude Code agent writes or updates unit tests for the changed code. The workflow then verifies the tests, commits them to the PR branch and reports the result in one PR comment.

## Where things are

| Piece | Location | Used for |
| --- | --- | --- |
| Custom agent | [.claude/agents/test-engineer.md](.claude/agents/test-engineer.md) | Steps: analyse → write → verify → report, ending in a JSON report |
| Skills | [.claude/skills/](.claude/skills) | `pr-change-analysis` decides per file whether to write, update or skip a test. `backend-unit-tests` and `frontend-unit-tests` hold this repo's test conventions. `test-verification` runs the red/green loop and defines what counts as green |
| Workflow | [.github/workflows/pr-test-agent.yml](.github/workflows/pr-test-agent.yml) | Runs on `pull_request` |
| Tooling | [scripts/pr-agent/](scripts/pr-agent) | Deterministic steps: plan, guard, sandboxed test runs, report. 35 tests |

**How a run goes:**
1. **Plan:** a script maps each changed source file to its test file. Backend `src/**/x.ts` maps to `tests/x.test.ts`, and frontend files to a co-located `x.test.ts(x)`.
2. **Agent:** `anthropics/claude-code-action` starts Claude Code, which delegates to the `test-engineer` subagent. The subagent loads the skills, writes tests, and runs them through the sandboxed CLI until they pass.
3. **Guard:** the run is discarded if the agent changed anything other than test files.
4. **Verify:** the workflow itself re-runs typecheck and the full test suites with coverage.
5. **Publish:** a separate job commits the verified tests to the PR branch and updates the PR comment.

## Technical decisions

- **Claude Code as the agent environment.** It is a real tool-using loop: the agent reads code, writes tests, runs them and fixes them. Agents and skills are plain Markdown files that also work locally in Claude Code.
- **The workflow decides, the agent proposes.** Planning, policy, verification and reporting are deterministic, tested code. Every pass/fail and coverage number in the comment comes from the workflow's own run, not from the agent.
- **Defence in depth:**
  - Tool allowlist: no web access, and Bash is limited to the test runner and read-only git.
  - Test-only guard, plus a re-check of the patch before committing.
  - Agent configuration and tooling are always taken from the base branch, so a PR can't weaken its own checks.
- **Sandboxed execution.** Install scripts and all tests run as a separate OS user, with no secrets and no network. A prompt-injected test can't read or leak the model key.
- **Split trust.** The job that runs PR code has a read-only token. The job with write access never runs PR code. The trigger is `pull_request`, not `pull_request_target`.
- **Results in the PR:**
  - One comment, updated in place.
  - The job summary.
  - A `pr-agent-results` artifact with the raw plan, decision, guard, test and coverage files.
  - The check turns red when the agent's tests are rejected.

## Running it

1. Put this code on the repository's default branch.
2. Add a repository secret: either `CLAUDE_CODE_OAUTH_TOKEN`, from `claude setup-token` (a Claude Pro or Max plan), or `ANTHROPIC_API_KEY`.
3. Open a non-draft PR from a branch in the same repository that changes app source.

Optional repository variables: `PR_AGENT_MODEL` (default `claude-sonnet-5-5`), and `PR_AGENT_AUTO_COMMIT=false` to get a patch artifact instead of a commit. Tooling tests can be run locally with `node --test "scripts/pr-agent/**/*.test.mjs"`.

## Coverage added to the existing app

| Area | Tests | Line coverage |
| --- | --- | --- |
| Backend | 58 → 107 | 55.6% → 93.7% |
| Frontend | 23 → 83 | 55.3% → 97.5% |

The new tests exposed four bugs, all now fixed: a wrong request id in error logs, an over-trusting proxy setting, a wrong content type on GET and FormData requests, and a schema check that ignored the schema name.

## Example run

The example PR adds a "Clear completed tasks" feature without tests, on branch `demo/clear-completed`. It changes a route, the repository, a mutation hook, the header and the page. It also breaks two existing tests, so the agent has to both write new tests and repair existing ones.

*Results to be added from the PR run: the agent's decision, the skills it used, the test files it wrote, and the test and coverage results.*

## Assumptions

- PRs come from branches in the same repository, whose authors are trusted to run code in CI, as normal CI already allows.
- Unit tests use the existing stack (Vitest with supertest or Testing Library) and need no database or network.

## Limitations

- Fork PRs are skipped, because they get no secrets.
- The agent's commit doesn't retrigger CI, since `GITHUB_TOKEN` pushes never do.
- Verification proves the tests pass, not that they are meaningful. That still needs a human review.
- Each run costs model tokens. A run is capped at 80 turns and 25 minutes.

## For production

- **GitHub App token:** so the agent's commits retrigger CI.
- **Fork PRs:** a label-gated flow for PRs from forks.
- **Reuse:** a config file per repo, so the agent works in other repositories without code changes.
- **Mutation testing:** to measure test quality, not just coverage.
- **Evaluation set:** recorded PRs with known expected decisions, re-run whenever a skill changes.
