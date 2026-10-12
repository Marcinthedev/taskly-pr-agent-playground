import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ChangePlan } from "./change-plan.ts";
import { createRepoTools } from "./repo-tools.ts";
import type { SandboxCommand } from "./sandbox.ts";

const plan: ChangePlan = { needsTests: true, areas: ["backend"], targets: [], ignored: [], changedTests: [] };

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-tools-"));
  const files: Record<string, string> = {
    "backend/src/x.ts": "export const answer = 42;\n",
    "backend/tests/x.test.ts": "it('works', () => {});\n",
    "backend/.env": "SECRET=1\n",
    "backend/node_modules/lib/index.js": "module.exports = 1;\n",
    ".git/config": "[core]\n",
    "skills/unit-test-quality/SKILL.md": "# Rules\n",
  };
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  const commands: SandboxCommand[] = [];
  const gitCalls: string[][] = [];
  const tools = createRepoTools({
    repoRoot: root,
    plan,
    skillsDir: path.join(root, "skills"),
    runCommand: (command) => (commands.push(command), { exitCode: 0, output: "ok" }),
    git: (args) => {
      gitCalls.push(args);
      if (args[0] === "ls-files") return args.at(-1) === "backend/tests/x.test.ts" ? "backend/tests/x.test.ts\n" : "";
      return "";
    },
  });
  return { root, tools, commands, gitCalls };
}

test("reads and lists repository files but hides secrets, git data and dependencies", () => {
  const { tools } = fixture();

  assert.equal(tools.readFile("backend/src/x.ts"), "export const answer = 42;\n");
  for (const denied of ["backend/.env", ".git/config", "backend/node_modules/lib/index.js", "../outside.txt", "/etc/passwd"]) {
    assert.throws(() => tools.readFile(denied), /not allowed|not found/, denied);
  }
  assert.deepEqual(tools.listFiles("backend"), ["backend/src/x.ts", "backend/tests/x.test.ts"]);
  assert.match(tools.search("answer", "backend"), /^backend\/src\/x\.ts:1: export const answer/);
  assert.equal(tools.search("SECRET"), "no matches");
});

test("writes only test files in the planned areas", () => {
  const { root, tools } = fixture();

  tools.writeFile("backend/tests/new/y.test.ts", "it('y', () => {});\n");
  assert.equal(fs.readFileSync(path.join(root, "backend/tests/new/y.test.ts"), "utf8"), "it('y', () => {});\n");

  for (const denied of ["backend/src/x.ts", "frontend/src/a.test.ts", "backend/package.json", "../escape.test.ts"]) {
    assert.throws(() => tools.writeFile(denied, "x"), /only/, denied);
  }
});

test("reverts tracked test files through git and deletes untracked ones", () => {
  const { root, tools, gitCalls } = fixture();
  tools.writeFile("backend/tests/z.test.ts", "x");

  tools.revertFile("backend/tests/x.test.ts");
  tools.revertFile("backend/tests/z.test.ts");

  assert.deepEqual(gitCalls.at(-1), ["ls-files", "--", "backend/tests/z.test.ts"]);
  assert.ok(gitCalls.some((args) => args.join(" ") === "checkout -- backend/tests/x.test.ts"));
  assert.equal(fs.existsSync(path.join(root, "backend/tests/z.test.ts")), false);
  assert.throws(() => tools.revertFile("backend/src/x.ts"), /only/);
});

test("runs the sandboxed commands only for planned areas", () => {
  const { tools, commands } = fixture();

  assert.deepEqual(tools.run("test", "backend", ["backend/tests/x.test.ts"]), { exitCode: 0, output: "ok" });
  assert.deepEqual(commands[0].args, ["vitest", "run", "tests/x.test.ts"]);
  assert.throws(() => tools.run("test", "frontend", []), /not part of this pull request/);
  assert.throws(() => tools.run("rm", "backend", []), /Unknown action/);
});

test("loads skills by name only", () => {
  const { tools } = fixture();

  assert.equal(tools.loadSkill("unit-test-quality"), "# Rules\n");
  assert.throws(() => tools.loadSkill("../../backend/.env"), /Unknown skill/);
  assert.throws(() => tools.loadSkill("missing"), /Unknown skill/);
});
