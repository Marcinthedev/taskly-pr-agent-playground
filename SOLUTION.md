# PR Test Agent

When a pull request touches `backend/src` or `frontend/src`, a Claude Code agent called the test-engineer writes or updates unit tests for the changed code. A GitHub Actions workflow then checks those tests, runs them, commits them to the PR branch and leaves a comment with the results.

I also used the same agent and skills to fill the gaps in the existing test suite:

| Area | Tests | Line coverage |
| --- | --- | --- |
| Backend | 58 → 107 | 55.6% → 93.7% |
| Frontend | 23 → 83 | 55.3% → 97.5% |

A few things I added beyond the task, just because I enjoyed building them, are listed in [SOLUTION_EXTENDED.md](SOLUTION_EXTENDED.md). The ones that would run automatically are switched off.

## 1. Technical decisions

**Claude Code as the agent.** I run it through the official `anthropics/claude-code-action`. The agent works in a loop: it reads the code, writes a test, runs it, reads the failure and fixes it. That matters, because a single model call that returns a diff has no way of knowing whether its tests pass. Agents and skills in Claude Code are just Markdown files, so the same setup also works locally.

**The agent proposes, the workflow decides.** Everything around the agent is ordinary, tested Node code: working out which files changed, checking what the agent touched, running the tests and writing the report. The numbers in the PR comment come from the workflow's own test run, never from what the agent says about itself.

**Several independent limits on the agent.** None of them is enough alone:
- It has no web access. In the shell it can only run the test runner, the formatter and read-only git commands. It can't read `/proc` or the runner's dotfiles.
- After it finishes, a guard throws the whole run away if anything other than test files changed. The patch is checked again just before it's committed.
- The agent's instructions, permissions and the checking code are always taken from the base branch. A PR can't loosen the rules it's judged by.

**PR code runs in a sandbox.** Installing dependencies and running tests happens as a separate Linux user with an empty environment and no network access. A malicious test, for example one planted through prompt injection, can't read the model token or send anything out.

**Write access is kept away from PR code.** The workflow uses `pull_request`, not `pull_request_target`. The job that runs PR code only has read access, and the job that can push never runs PR code.

**Tests are committed straight to the PR branch.** The agent only touches test files, and you review them in the same PR anyway. A separate PR just for tests would add a step without making anything safer.

**Generated tests have to meet the repo's standards.** They must pass the strict typecheck, frontend tests must match the Prettier config, and all tests must follow the quality rules in section 3. Anything that doesn't is rejected rather than committed.

## 2. Running it

You need:
1. This code on the repository's default branch.
2. A repository secret holding the model credential. That's either `CLAUDE_CODE_OAUTH_TOKEN`, which you get from `claude setup-token` with a Claude Pro or Max plan, or an `ANTHROPIC_API_KEY`.

Three optional repository variables:
- `PR_AGENT_ALLOWED_USERS` lists who may trigger the agent, as comma-separated GitHub logins. If it isn't set, only the repository owner can.
- `PR_AGENT_MODEL` picks the model. The default is `claude-sonnet-5-5`.
- `PR_AGENT_AUTO_COMMIT=false` attaches the tests as a patch file instead of committing them.

The agent runs when an allowed user opens or updates a non-draft PR, from a branch in the same repository, that changes application source. Each run leaves:
- one comment on the PR, updated in place and copied into the job summary
- a table with typecheck, formatting and test results, and coverage before and after
- the tokens, turns, estimated cost and duration the agent used, also written into its commit message
- a `pr-agent-results` artifact with the raw files behind all of the above
- a red check if the agent's tests were rejected

## 3. The agent and its skills

| What | Where | What it does in a run |
| --- | --- | --- |
| `test-engineer` agent | [.claude/agents/test-engineer.md](.claude/agents/test-engineer.md) | Analyses the change, writes the tests, verifies them and reports in a fixed JSON format |
| `pr-change-analysis` skill | [.claude/skills/](.claude/skills) | Decides for each changed file whether to write a test, update one or skip it, and why |
| `unit-test-quality` skill | same | Defines what a good unit test is |
| `backend-unit-tests`, `frontend-unit-tests` skills | same | This repo's test conventions: what to fake and how |
| `test-verification` skill | same | The run-fix-repeat loop, formatting, typecheck, and when a passing test actually counts |
| Workflow | [.github/workflows/pr-agents.yml](.github/workflows/pr-agents.yml) | Runs everything and enforces the trust boundaries |
| Tooling | [scripts/pr-agent/](scripts/pr-agent) | Planner, guard, sandboxed runner, formatter, report and usage. A separate TypeScript package with 52 tests, run directly by Node and not part of any app build |

A run goes like this:
1. The planner maps each changed source file to its test file. It ignores files with nothing to test, such as types, constants, styles and entry points.
2. The agent loads its skills and writes tests. It runs them, the typecheck and the formatter until everything is green.
3. The guard checks that only test files changed.
4. The workflow runs the typecheck, the formatting check and the full test suites again, with coverage.
5. The tests are committed to the PR branch and the comment is updated.

**What makes a good unit test.** This is written down once, in [`unit-test-quality`](.claude/skills/unit-test-quality/SKILL.md), and every test the agent writes has to follow it. A good test:
1. checks one behaviour, and its name says which
2. uses the module's public interface, not its internals
3. fails if you break the code it checks
4. compares against fixed expected values, with strict matchers
5. covers the edge cases, not just the happy path
6. only fakes the outside world: network, database, clock
7. doesn't depend on other tests, the time or the network
8. is easy to read, with no logic in the test and nothing skipped
9. passes the typecheck and the formatter without tricks like `@ts-ignore` or `as any`

The tests I added to the existing app follow the same rules. Writing them down made them explicit for the agent.

## 4. Example run

The example PR is on the branch `demo/clear-completed-v2`. It adds a "Clear completed tasks" feature without any tests: a backend route and repository method, plus a frontend API call, a mutation hook, a header button and the page wiring. It also breaks two existing tests on purpose, so CI is red on the feature commit.

The planner found 7 files to cover, across backend and frontend, and skipped `openapi.json` and `types.ts`.

The agent then committed `f0f1ddb` as `github-actions[bot]`, with 7 test files and 242 new lines:
- It repaired `router.test.ts`, whose fake store was missing the new method, and `TodosPage.test.tsx`, which didn't mock the new hook. It also added tests for clearing tasks.
- It extended `repository.test.ts`, `todos.test.ts` and `TodosHeader.test.tsx`.
- It created `useClearCompletedMutation.test.ts` and `queryKeys.test.ts`.

CI, which at the time also ran the full app suites, passed on the bot's commit. The agent's own check shows as skipped there, which is correct: the agent never runs on bot commits.

Two lessons from this run went back into the agent:
- The `queryKeys` test was weak. It checks that the new key sits under the `todos` prefix, which does matter, because the page's busy state depends on it. But it does that by repeating the constant instead of testing the behaviour. The planner now skips constants files, so that invariant has to be tested through the page itself.
- The usage numbers were too low. They only counted the coordinating agent, not the subagent that did the work. They now include both.

*The agent's decision, the skills it used and the verification table still need to be copied in from the PR comment.*

## 5. Assumptions

- PRs come from branches in the same repository, and their authors are trusted to run code in CI, as with normal CI.
- Unit tests use the existing stack (Vitest with supertest or Testing Library) and don't need a database or network.
- One test file per source file is a sensible default, though the agent can pick another file if it has a reason.

## 6. Limitations and failure scenarios

**Passing tests aren't necessarily useful tests.**

| What can go wrong | What prevents it | What's left |
| --- | --- | --- |
| Weak tests that can't really fail | Quality rules 3 and 4. The planner skips constants files | Nothing detects this automatically. It needs a human review |
| A bug written down as the expected behaviour | The agent is told to report suspected bugs instead of asserting them | It can still misjudge what the code is meant to do |
| An existing test weakened to make it pass | Deleting tests is blocked, and every change shows in the PR diff | Removing an assertion from a test isn't flagged |
| The agent wrongly decides no tests are needed | Its reasoning is shown in the comment | Nothing checks whether the changed lines are covered |
| Flaky tests | Fake timers and fake IO are required | Each test runs only once during verification |

**Reliability.**

| What can go wrong | What happens |
| --- | --- |
| The model is down or rate-limited, or the agent hits its turn or time limit | The run fails cleanly, with a red check and a reason. Normal CI isn't affected |
| The agent returns no report, or a broken one | It counts as a failure, never as "nothing to do" |
| The agent stops halfway, or leaves unformatted code | The guard and verification still run. Only green, test-only changes are committed |
| Someone pushes while the agent is running | The commit is refused, and the next push starts over |
| Two pushes in quick succession | The older run is cancelled |
| A very large PR | The diff is capped at 400 KB, and many files can use up the turn limit |

The first real runs found four bugs, all fixed now:
- the sandbox user couldn't read the checkout
- the two users couldn't share the coverage folder
- GitHub sometimes reports an outdated base commit
- the usage numbers only counted the coordinating agent

**Security.**

| Threat | How it's handled |
| --- | --- |
| Prompt injection hidden in the PR | No web tools, a shell limited to the runner, the formatter and read-only git, and edits outside tests denied and caught by the guard |
| A malicious test trying to steal the model token | Tests run as another user, with an empty environment and no network. The agent can't read `/proc` or the runner's dotfiles |
| Test code tampering with the results | The results folder is private. The patch is taken before the tests run and compared afterwards |
| A PR weakening its own checks | The agent's instructions, permissions and tooling come from the base branch |
| Someone else using up your tokens | Only users in `PR_AGENT_ALLOWED_USERS` trigger the agent. Everyone else, bots included, is skipped with a notice |
| Pull requests from forks | They don't run the agent and never get secrets. Write access is never given to a job that runs PR code |
| Compromised dependencies or actions | Actions are pinned to exact commits. Dependencies are installed from the lockfile, inside the sandbox |
| The agent triggering itself, and runaway cost | Runs triggered by bots are skipped. Each run is capped at 80 turns and 25 minutes |

One known gap remains: the patch isn't scanned for secrets before it's committed. It would be a last safety net if a token ever ended up in a file.

## 7. What I'd change for production

- Credentials: scan every patch for secrets before committing it, and replace the static token with short-lived credentials via workload identity federation.
- Proving the tests are worth something:
  - Run each new test against the code before the change. It should fail there and pass after.
  - Report coverage of the changed lines specifically.
  - Flag assertions that were removed from existing tests.
  - Run new tests a few times to catch flakiness.
- Retry once when the model is temporarily unavailable.
- Less brittle fakes: one shared typed fake per interface, and page tests that only mock the API layer. Changing an interface then stops breaking unrelated tests.
- Reuse: a small config file per repository, listing source folders, test locations and commands, so other projects can use the agent without code changes.
- Track quality over time: keep a set of recorded PRs with known correct decisions, and re-run them whenever a skill changes. Mutation testing would add a second signal.

**Using fewer tokens.** Usage is now reported on every run, so the effect of each change can be measured. Roughly in order of savings:
1. Don't run when there's nothing to do.
   - Only look at commits pushed since the last run, not the whole PR.
   - Skip whitespace-only, comment-only and rename-only changes before the agent starts.
   - Skip files whose changed lines are already covered, using the coverage the workflow already measures.
   - Consider running only when a PR is marked ready, or on a `/test-agent` comment.
2. Give the agent less to read. Prepare the changed functions, the existing test, the fixtures and the relevant types up front, instead of letting the agent search for them turn by turn.
3. Make each run smaller.
   - Run the agent directly instead of through a coordinating agent.
   - Lower the limits to about 30 turns and 2 fix attempts per file.
   - Use a small model to decide which files need tests, and a bigger one only to write them.
   - Keep the instructions stable, so prompt caching works.

**A whole-codebase mode.** As an alternative to working PR by PR, a weekly or manually started workflow could pick the N least-covered files, run the same agent on them under a fixed turn limit, and open one PR with the new tests. That keeps the cost per run fixed while coverage goes up a little each time.
