# Try the PR Test Agent in a playground repository

About 30 minutes. You push this repo to a new, throwaway GitHub repository, open one feature PR without tests, and watch the agent write, verify and commit them. Your real `origin` stays untouched.

## 1. Create the playground repository

On GitHub, create an empty repository, for example `taskly-pr-agent-playground`. Do not add a README or a licence. Private is fine. Actions are enabled by default, and private repos use your free Actions minutes.

## 2. Give the agent a credential

Open the playground repo, go to **Settings → Secrets and variables → Actions → New repository secret**, and add **one** of these secrets:

| Secret | Where it comes from | Billing |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Run `claude setup-token` in the Claude Code CLI and paste the token | Your Claude Pro/Max subscription |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys | Pay per token |

**Shortcut:** in the Claude Code CLI, `/install-github-app` walks you through the same thing and stores the secret for you. The workflow needs only the secret. It talks to GitHub with the built-in `GITHUB_TOKEN`, not the Claude app.

**Optional:** under **Variables**, set `PR_AGENT_MODEL` to choose a model, or set `PR_AGENT_AUTO_COMMIT=false` to get a patch artifact instead of a commit.

## 3. Push `main` to the playground

Run these from the app repository root, `taskly-app-node/taskly-app-node`:

```sh
git remote add playground git@github.com:<you>/taskly-pr-agent-playground.git
git push playground main
```

## 4. Open the demo PR

[`clear-completed-tasks.patch`](clear-completed-tasks.patch) adds a "Clear completed tasks" feature with no tests:
- **Backend:** a `DELETE /api/todos/completed` route and a repository method.
- **Frontend:** an API call, a mutation hook, and a header button.

```sh
git checkout -b demo/clear-completed
git apply docs/pr-agent-demo/clear-completed-tasks.patch
git add -A
git commit -m "feat: clear completed tasks"
# --no-verify: the pre-push hook would stop this feature, which breaks two tests on purpose
git push --no-verify playground demo/clear-completed
```

On GitHub, open a pull request **in the playground repo**: `demo/clear-completed` → `main`.

The patch deliberately breaks two existing tests. The backend router test's fake repository lacks the new method, so the backend typecheck fails. The page tests don't mock the new hook, so they fail. The agent must fix both and add tests for the new code.

## 5. Watch it work (about 10–20 minutes)

1. **Actions → PR Test Agent**:
   - The *Plan, write and verify tests* job runs the planner, the sandboxed install, the agent, the guard and the verification.
   - *Commit verified tests and report* follows.
2. **The PR** gets one comment with these sections:
   - the outcome
   - the agent's decision and the skills it used
   - the test files it wrote
   - a typecheck, tests and coverage table, before and after
   - the change plan
3. **The branch** gets a commit `test: add unit tests for changed code [pr-test-agent]` from `github-actions[bot]`. Pull it with `git pull playground demo/clear-completed`.
4. **Everything raw** is in the run's `pr-agent-results` artifact:
   - `status.json`: why the run ended as it did
   - `guard.json`: which files were allowed or rejected
   - `decision.json`: the agent's report
   - the Vitest JSON and coverage summaries
   - `tests.patch`

Commits pushed with `GITHUB_TOKEN` do not start new workflow runs, so CI still shows the red result from before the agent's commit. To re-run CI, push any commit, even an empty one:

```sh
git commit --allow-empty -m "ci: re-run checks"
git push playground demo/clear-completed
```

That also re-runs the agent. It should now find the tests in place and report that no changes are needed.

## 6. Things worth trying

| Try | Expected |
| --- | --- |
| A PR that changes only `README.md` | The agent workflow does not start, because of its path filter |
| Mark the PR as draft, then push | The agent is skipped until the PR is ready for review |
| A PR that edits `.claude/skills/**` and source | The run uses the `main` version of the skills, and the log shows a notice |
| Set `PR_AGENT_AUTO_COMMIT=false` and push | No commit. The comment points to the patch artifact |
| Push a second commit while the agent runs | The older run is cancelled. If a run finishes after the branch moved, it refuses to commit |

## 7. If something goes wrong

| Symptom | Look at |
| --- | --- |
| Comment says "the agent run did not complete" | The *Run the test-engineer agent* step log. Usually the secret is missing or invalid, or the turn or time limit was hit |
| "outside the test-only policy" | `guard.json` in the artifact lists the files that were rejected |
| "failed typecheck or the test suite" | `*-tests.json` and the *Verify* step log |
| Verified, but no commit | A branch ruleset blocks `github-actions[bot]`, or the branch moved during the run |
| *Cut the sandbox user off the network* fails | The runner image changed its iptables setup. Report it; the step fails closed |

## 8. Clean up

```sh
git checkout main
git branch -D demo/clear-completed
git remote remove playground
```

Then delete the playground repository on GitHub (**Settings → Danger zone**) and revoke the token or API key if you created one only for this.
