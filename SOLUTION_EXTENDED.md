# Extras

Things I added while working on this, mostly because I enjoyed building them. None of them is needed for the task. The ones that would run automatically are switched off by commenting them out, so they're easy to turn back on.

## Testability agent (switched off)

A second agent, the testability-refactorer. It takes logic that's hard to test, such as code buried in a route handler or a React component, moves it into small, pure functions, and writes tests for them. Its rules are stricter than the test agent's. It may only touch source files the PR already changed, plus new files next to them, and it may never edit an existing test. If the old tests still pass untouched, the behaviour hasn't changed. Its result arrives as a separate PR into your feature branch.

It's defined in [.claude/agents/testability-refactorer.md](.claude/agents/testability-refactorer.md), with two skills of its own, [testability-review](.claude/skills/testability-review/SKILL.md) and [safe-refactor](.claude/skills/safe-refactor/SKILL.md), and its own [permissions](.github/pr-agent/testability-refactorer.settings.json).

To turn it on, edit [.github/workflows/pr-agents.yml](.github/workflows/pr-agents.yml):
1. Add `labeled` back to the triggers.
2. Uncomment the two steps marked "Testability agent".
3. In the *Render report* step, pass `PR_URL` and `PR_NUMBER` from the refactor step to the report again.

Then create a `testability` label, and enable *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests*. Adding the label to a PR starts it.

## Pre-push hook (switched off)

[.husky/pre-push](.husky/pre-push) runs the typecheck, Prettier and the related tests for whatever you're about to push. To use it, uncomment its body and run `npm install` once at the repository root.

## App CI (switched off)

The backend and frontend validation jobs in [.github/workflows/ci.yml](.github/workflows/ci.yml) run the typecheck, the tests and the frontend build on every PR. The PR agents workflow already does the same for PRs that change app code, so they're commented out. Uncomment them to get CI on every PR, whatever it changes.

## API hardening (on)

This is plain app code with its own tests, so it stays enabled:
- security headers on every response (helmet)
- cross-origin requests only from the origins listed in `CORS_ORIGINS`
- a per-client rate limit on the task API (`RATE_LIMIT_MAX`, default 300 a minute)
- separate liveness and readiness health checks (`/api/health/live` and `/api/health/ready`)
