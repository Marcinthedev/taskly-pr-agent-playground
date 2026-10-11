---
name: pr-change-analysis
description: Decides which changed source files in a pull request need new or updated unit tests. Use when triaging a PR diff for test work.
---

# PR change analysis

Turn the plan's `targets` into a per-file decision: `write` (no test file yet), `update` (extend the existing test file) or `skip`.

## For each target

1. Read the hunks for the file in `.pr-agent/pr.diff`, then read the whole source file at HEAD. The diff shows what moved; the file shows the contract.
2. Name the **behaviour delta** in one line: what a caller can now observe that it could not before (new route, new branch, new error, changed return shape, fixed bug). Collaborators' types and call sites (Grep) tell you what callers rely on.
3. If `testFileExists`, read the test file and check whether it already asserts that delta.
4. Decide:

| Situation | Decision |
| --- | --- |
| New observable behaviour, or a fix, and no test asserts it | `write` / `update` |
| Existing tests assert the old behaviour that changed | `update` those cases |
| Rename, formatting, comments, type-only or log-text change | `skip`: no behaviour delta |
| Behaviour needs a real database, network or browser to observe | `skip`: needs integration test |
| Delta already asserted by an existing test | `skip`: already covered |

5. When the PR author already changed the matching test (`plan.changedTests`), extend it only for deltas their tests leave unasserted.

Done when every target has a decision, the behaviour delta it rests on, and the test file it lands in. Prefer the planned test file; a different file needs a reason.
