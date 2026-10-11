# PR Test Agent: extensions beyond the task

[SOLUTION.md](SOLUTION.md) covers what the task asks for. This file describes two additions that go beyond it. They're built on the same workflow, sandbox and checks.

## Testability agent

**What it does.** The **testability-refactorer** extracts hard-to-test logic from the files a PR changed, such as logic inside route handlers and React components or calculations mixed with IO, into small, pure, exported functions. It then unit-tests them. The result is easier to test and to reuse, with no change in behaviour.

**Trigger.** On demand: add the `testability` label to a PR. The label is removed after the run, so adding it again starts a new run. It runs only for users in `PR_AGENT_ALLOWED_USERS`, like the test agent.

**Definition**

| Piece | Location | Role |
| --- | --- | --- |
| `testability-refactorer` agent | [.claude/agents/testability-refactorer.md](.claude/agents/testability-refactorer.md) | Review → extract → test → verify → report |
| `testability-review` skill | [.claude/skills/testability-review/](.claude/skills/testability-review/SKILL.md) | Finds logic that is hard to test or reuse, and ranks candidates |
| `safe-refactor` skill | [.claude/skills/safe-refactor/](.claude/skills/safe-refactor/SKILL.md) | Extracts pure functions without changing behaviour |
| Reused skills | `unit-test-quality`, `backend-unit-tests`, `frontend-unit-tests`, `test-verification` | Its tests follow the same nine rules as the test agent's |
| Permissions | [.github/pr-agent/claude-settings-refactor.json](.github/pr-agent/claude-settings-refactor.json) | Like the test agent's, but application source is editable |

**Guard policy.** This agent changes application code, so its rules are stricter than the test agent's:
- it may modify only the source files the PR already changed
- it may add new modules, but only in the same folder as a changed source file
- it may add new test files
- it may never edit an existing test

Existing tests must stay green without edits, which is the evidence that behaviour didn't change.

**Delivery.** The verified refactor is opened as a separate PR, "Refactor for testability: #N", into the feature branch, with its own comment on the original PR. You approve it by merging it, or reject it by closing it.

**Prerequisites**
- a `testability` label in the repository
- Settings → Actions → General → **Allow GitHub Actions to create and approve pull requests**, so the workflow can open the refactor PR

**Remaining risk.** Behaviour that no existing test covers can still change unnoticed. The new tests and your review of the refactor PR are the safeguards there.

## Local pre-push hook (husky)

**What it does.** Before `git push`, [.husky/pre-push](.husky/pre-push) checks only what you're about to push, compared with the remote branch, or with `origin/main` for a branch that was never pushed:
- **Backend:** typecheck, plus the tests related to the changed files.
- **Frontend:** typecheck, Prettier on the changed files, plus the related tests.

It stops early with a clear message if the shell's Node.js is older than 22.

**Setup.** Run `npm install` once at the repository root. The root `package.json` exists only for this hook.

**Caveats**
- The hook runs only on machines where that install was done.
- `git push --no-verify` skips it. The demo feature, which breaks tests on purpose, is pushed that way.
- CI remains the authority; the hook only surfaces the same problems earlier.
