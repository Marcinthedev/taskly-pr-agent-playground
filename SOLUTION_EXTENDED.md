# Beyond the task

[SOLUTION.md](SOLUTION.md) covers what the task asked for. This file describes two extras I built on top of it. Both reuse the same workflow, sandbox and checks.

## Testability agent

The test agent writes tests for code as it is. Sometimes the code itself is the problem: logic buried in a route handler or a React component, or a calculation that reads the clock or the environment. That kind of code is awkward to test and impossible to reuse.

The testability-refactorer goes after exactly that. It looks at the files a PR changed, pulls hard-to-test logic out into small, pure, exported functions, and writes unit tests for them. Behaviour stays the same; only the structure changes.

**Starting it.** Add the `testability` label to a PR. When the run finishes, the workflow removes the label again, so adding it a second time starts a new run. Only users in `PR_AGENT_ALLOWED_USERS` can trigger it, the same as the test agent.

**Where it's defined**

| What | Where |
| --- | --- |
| The agent | [.claude/agents/testability-refactorer.md](.claude/agents/testability-refactorer.md) |
| Finding candidates | [.claude/skills/testability-review/](.claude/skills/testability-review/SKILL.md) |
| Extracting without changing behaviour | [.claude/skills/safe-refactor/](.claude/skills/safe-refactor/SKILL.md) |
| Its permissions | [.github/pr-agent/testability-refactorer.settings.json](.github/pr-agent/testability-refactorer.settings.json) |

It also reuses `unit-test-quality`, the two test-convention skills and `test-verification`, so its tests follow the same rules as the test agent's.

**Its rules.** This agent changes application code, so its rules are stricter than the test agent's. It may change only the source files the PR already changed. It may add new modules, but only next to those files, plus new test files. It may never edit an existing test. That last rule is the important one: if the old tests still pass without being touched, the behaviour hasn't changed.

**What you get.** The verified refactor isn't pushed to your branch. It's opened as a separate PR into your feature branch, called "Refactor for testability: #N", and the original PR gets a comment linking to it. Merge it if you like it, close it if you don't.

**Setup.** Create a `testability` label in the repository. Then enable *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests*, so the workflow is allowed to open the refactor PR.

**What it can't guarantee.** If a piece of behaviour isn't covered by any existing test, the refactor could change it without anything failing. The new tests and your review of the refactor PR are the safety net there.

## Pre-push hook

[.husky/pre-push](.husky/pre-push) runs before every `git push` and checks only what you're about to push. It compares against the remote branch, or against `origin/main` for a branch that has never been pushed. For backend changes, it runs the typecheck and the tests related to the changed files. For frontend changes, it does the same and also runs Prettier on the changed files. Changes to the agent tooling in `scripts/pr-agent` get that package's typecheck and tests. If your shell's Node.js is older than 22.18, it stops with a clear message instead of failing in a confusing way.

To enable it, run `npm install` once at the repository root. The root `package.json` exists only for this hook.

It only runs on machines where that install was done, and `git push --no-verify` skips it. The demo feature is pushed that way, because it breaks tests on purpose. CI is still the real check; the hook just shows you the same problems a few minutes earlier.
