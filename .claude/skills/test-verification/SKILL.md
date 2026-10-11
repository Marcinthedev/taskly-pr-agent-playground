---
name: test-verification
description: Runs and fixes newly written unit tests in the credential-free sandbox until they are green and typecheck. Use after writing or editing any test file.
---

# Test verification

A test counts only once you have watched it pass. Run everything through the sandboxed runner; it strips credentials from the environment and accepts only test files of one area.

```sh
node scripts/pr-agent/cli.mjs test backend backend/tests/router.test.ts
node scripts/pr-agent/cli.mjs test frontend frontend/src/lib/http.test.ts
node scripts/pr-agent/cli.mjs typecheck backend
```

## Loop, per touched test file

1. Run the file. Green → next file.
2. Red → read the first failure and classify it:
   - **Test mistake** (wrong import, wrong query, wrong fixture value, missing `await`): fix the test, go to 1.
   - **Source disagrees with the intended behaviour** (the diff, names or docs say one thing, the code does another): the test is right. Remove that case, and record the suspected bug in the report's `skipped`.
3. After three red runs of the same file, revert it (`git restore -- <file>` for an existing file, `git clean -f -- <file>` for one you created) and record it in `skipped`.

Then, for each touched area:
1. **Format** the frontend test files you touched: `node scripts/pr-agent/cli.mjs format frontend <files>`. The workflow rejects unformatted frontend tests.
2. **Typecheck** the area. Type errors in your tests are test mistakes. Fix them with real types, never `@ts-ignore` or `as any` (rule 9).
3. **Re-run** the touched files once more after any formatting or type fixes.

## A green that counts

A green run counts only when every touched test also meets the `unit-test-quality` rules. Fix a red test by correcting its setup or its understanding of the behaviour. Keep its matcher as strict as when you wrote it. For each new test, apply rule 3: name the source line that makes it pass.

Done when every touched file is green in a focused run, every touched frontend file is formatted, every touched area typechecks, and every reverted file is listed in `skipped` with its reason.
