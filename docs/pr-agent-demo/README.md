# Trying the PR Test Agent in a playground repo

This takes about half an hour. You push a copy of this project to a throwaway GitHub repository, open a PR that adds a feature without tests, and watch the agent write the tests, check them and commit them. Your real repository isn't touched.

## 1. Create the playground repository

Create a new, empty repository on GitHub, for example `taskly-pr-agent-playground`. Leave the README, .gitignore and licence options unticked, otherwise your first push gets rejected. A private repository works fine; it just uses your free Actions minutes.

## 2. Add a credential for the agent

In the playground repo, go to *Settings → Secrets and variables → Actions*, and add one of these secrets:

| Secret | How to get it | Paid by |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Run `claude setup-token` in the Claude Code CLI and copy the token it prints | Your Claude Pro or Max subscription |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys | Pay per token |

If you'd rather not do it by hand, `/install-github-app` in the Claude Code CLI sets up the secret for you. The workflow only needs the secret; it talks to GitHub with the built-in `GITHUB_TOKEN`.

You can also set two optional variables under *Variables*: `PR_AGENT_MODEL` to choose the model, and `PR_AGENT_AUTO_COMMIT=false` to get the tests as a patch file instead of a commit.

## 3. Push the code

From the app's root folder (`taskly-app-node/taskly-app-node`):

```sh
git remote add playground git@github.com:<you>/taskly-pr-agent-playground.git
git push playground main
```

## 4. Open the demo PR

[`clear-completed-tasks.patch`](clear-completed-tasks.patch) adds a "Clear completed tasks" feature with no tests. On the backend, that's a `DELETE /api/todos/completed` route and a repository method. On the frontend, it's an API call, a mutation hook and a button in the header.

```sh
git checkout -b demo/clear-completed
git apply docs/pr-agent-demo/clear-completed-tasks.patch
git add -A
git commit -m "feat: clear completed tasks"
git push playground demo/clear-completed
```

Then open a pull request in the playground repo, from `demo/clear-completed` into `main`.

The patch breaks two existing tests on purpose. The router test's fake repository doesn't have the new method, so the backend typecheck fails. The page tests don't mock the new hook, so they crash. The agent has to fix both, as well as write tests for the new code.

## 5. Watch it work

It usually takes 10 to 20 minutes.

In the *Actions* tab, open the *PR agents* run. The first job, *Plan, write and verify tests*, does the real work: it plans, installs dependencies in the sandbox, runs the agent, checks its changes and verifies them. The second job, *Commit verified tests and report*, publishes the result.

When it's done:
- **A comment on the PR** shows the outcome, the agent's decision and the skills it used, and the test files it wrote. It also has a table with typecheck, formatting, test results and coverage, plus the tokens and time the agent used.
- **A new commit on the branch**, `test: add unit tests for changed code [pr-test-agent]`, from `github-actions[bot]`. Get it locally with `git pull playground demo/clear-completed`.
- **The agent's check on that commit shows as skipped.** That's intentional, because the agent never runs on bot commits.
- **The run's `pr-agent-results` artifact** holds the raw files: why the run ended the way it did (`status.json`), which files were allowed (`guard.json`), the agent's report (`decision.json`), the test results, the coverage and the patch.

## 6. Things to try next

| Try this | What should happen |
| --- | --- |
| A PR that only changes `README.md` | The agent doesn't start at all |
| Mark the PR as a draft and push again | The agent waits until the PR is ready for review |
| A PR that changes `.claude/skills/` as well as source | The run still uses the skills from `main`, and the log says so |
| Set `PR_AGENT_AUTO_COMMIT=false` and push | No commit. The comment points to the patch file instead |
| Push again while the agent is still running | The older run is cancelled. A run that finishes after the branch moved won't commit |

## 7. When something goes wrong

| What you see | Where to look |
| --- | --- |
| "the agent run did not complete" | The log of the *Run the agent* step. Usually the secret is missing or invalid, or the agent ran out of turns or time |
| "changed files outside its policy" | `guard.json` in the artifact lists the files that weren't allowed |
| "failed typecheck, formatting or the test suite" | The test results in the artifact, and the log of the *Verify* step |
| The tests were verified but not committed | Something blocks `github-actions[bot]` from pushing, or the branch moved during the run |
| The *Cut the sandbox user off the network* step fails | The runner image probably changed its firewall setup. The step fails safely, so nothing runs without the sandbox |

## 8. Cleaning up

```sh
git checkout main
git branch -D demo/clear-completed
git remote remove playground
```

Then delete the playground repository on GitHub (*Settings → Danger zone*), and revoke the token or API key if you created it only for this.
