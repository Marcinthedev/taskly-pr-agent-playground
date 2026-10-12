# Extras

Things I added because I enjoyed building them. None is needed for the task. The ones that would run automatically are commented out, so they're easy to turn back on.

## Testability agent (off)

The testability-refactorer moves hard-to-test logic, such as code buried in a route handler or a React component, into small, pure functions and writes tests for them. It may only touch source files the PR changed, plus new files next to them, and never an existing test: if the old tests still pass untouched, behaviour hasn't changed. Its result arrives as a separate PR into your feature branch.

It's defined in [.claude/agents/testability-refactorer.md](.claude/agents/testability-refactorer.md), with the skills [testability-review](.claude/skills/testability-review/SKILL.md) and [safe-refactor](.claude/skills/safe-refactor/SKILL.md) and its own [permissions](.github/pr-agent/testability-refactorer.settings.json).

To turn it on, in [.github/workflows/pr-agents.yml](.github/workflows/pr-agents.yml):
1. Add `labeled` back to the triggers.
2. Uncomment the two steps marked "Testability agent".
3. In the *Render report* step, pass `PR_URL` and `PR_NUMBER` from the refactor step to the report.

Then create a `testability` label and enable *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests*. Adding the label to a PR starts it.

## Pre-push hook (off)

[.husky/pre-push](.husky/pre-push) runs the typecheck, Prettier and the related tests for what you're about to push. To use it, uncomment its body and run `npm install` once at the repository root.

## App CI (off)

The backend and frontend jobs in [.github/workflows/ci.yml](.github/workflows/ci.yml) run the typecheck, the tests and the frontend build on every PR. The PR agents workflow already does this for PRs that change app code, so they're commented out. Uncomment them for CI on every PR.

## API hardening (on)

Plain app code with its own tests, so it stays on:
- security headers on every response (helmet)
- cross-origin requests only from `CORS_ORIGINS`
- a per-client rate limit on the task API (`RATE_LIMIT_MAX`, default 300 a minute)
- separate liveness and readiness checks (`/api/health/live`, `/api/health/ready`)
