import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { AgentTools } from "./agent-loop.ts";
import type { ChangePlan } from "./change-plan.ts";
import { type SandboxCommand, sandboxCommand } from "./sandbox.ts";
import { isArea, isSafeRelativePath, normalizePath, testAreaOf } from "./test-locations.ts";

type RunCommand = (command: SandboxCommand) => { exitCode: number; output: string };
type Git = (args: string[]) => string;

const HIDDEN_SEGMENTS = new Set([".git", "node_modules", ".claude-pr", ".pr-agent", "coverage", "dist"]);
const MAX_READ_BYTES = 200_000;
const MAX_WRITE_BYTES = 200_000;
const MAX_LISTED = 500;
const MAX_MATCHES = 100;
const RUN_ACTIONS = ["test", "typecheck", "format"];

function isHidden(file: string): boolean {
  return file.split("/").some((segment) => HIDDEN_SEGMENTS.has(segment) || segment === ".env" || segment.startsWith(".env."));
}

export function createRepoTools({
  repoRoot,
  plan,
  skillsDir,
  runCommand,
  git = (args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }),
}: {
  repoRoot: string;
  plan: ChangePlan;
  skillsDir: string;
  runCommand: RunCommand;
  git?: Git;
}) {
  const root = fs.realpathSync(repoRoot);

  function readable(input: string): string {
    const file = normalizePath(input) || ".";
    if (file !== "." && (!isSafeRelativePath(file) || isHidden(file))) throw new Error(`Reading ${input} is not allowed`);
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) throw new Error(`${input} not found`);
    const real = fs.realpathSync(absolute);
    if (real !== root && !real.startsWith(root + path.sep)) throw new Error(`Reading ${input} is not allowed`);
    return file;
  }

  function writable(input: string): string {
    const file = normalizePath(input);
    const area = testAreaOf(file);
    if (!area || !plan.areas.includes(area)) {
      throw new Error(`${input}: only test files in ${plan.areas.join(", ") || "no area"} may be changed`);
    }
    const absolute = path.join(root, file);
    if (fs.existsSync(absolute) && fs.lstatSync(absolute).isSymbolicLink()) throw new Error(`${input}: only regular files may be changed`);
    return file;
  }

  function walk(dir: string, visit: (file: string) => boolean): void {
    const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = dir === "." ? entry.name : `${dir}/${entry.name}`;
      if (isHidden(file) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(file, visit);
      else if (entry.isFile() && !visit(file)) return;
    }
  }

  function listFiles(dir: string): string[] {
    const files: string[] = [];
    walk(readable(dir), (file) => (files.push(file), files.length < MAX_LISTED));
    return files;
  }

  return {
    listFiles,

    readFile(input) {
      const file = readable(input);
      const stat = fs.statSync(path.join(root, file));
      if (!stat.isFile()) throw new Error(`${input} is not a file`);
      if (stat.size > MAX_READ_BYTES) throw new Error(`${input} is too large to read`);
      return fs.readFileSync(path.join(root, file), "utf8");
    },

    search(pattern, dir = ".") {
      const regex = new RegExp(pattern);
      const matches: string[] = [];
      walk(readable(dir), (file) => {
        const absolute = path.join(root, file);
        if (fs.statSync(absolute).size > MAX_READ_BYTES) return true;
        fs.readFileSync(absolute, "utf8")
          .split("\n")
          .forEach((line, index) => {
            if (matches.length < MAX_MATCHES && regex.test(line)) matches.push(`${file}:${index + 1}: ${line.trim()}`);
          });
        return matches.length < MAX_MATCHES;
      });
      return matches.length ? matches.join("\n") : "no matches";
    },

    writeFile(input, content) {
      const file = writable(input);
      if (Buffer.byteLength(content) > MAX_WRITE_BYTES) throw new Error(`${input} is too large to write`);
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    },

    revertFile(input) {
      const file = writable(input);
      if (git(["ls-files", "--", file]).trim()) git(["checkout", "--", file]);
      else fs.rmSync(path.join(root, file), { force: true });
    },

    run(action, area, files) {
      if (!RUN_ACTIONS.includes(action)) throw new Error(`Unknown action: ${action}`);
      if (!isArea(area) || !plan.areas.includes(area)) throw new Error(`${area} is not part of this pull request`);
      return runCommand(sandboxCommand(action, area, files.map(normalizePath)));
    },

    loadSkill(name) {
      const file = path.join(skillsDir, name, "SKILL.md");
      if (!/^[a-z0-9-]+$/.test(name) || !fs.existsSync(file)) throw new Error(`Unknown skill: ${name}`);
      return fs.readFileSync(file, "utf8");
    },
  } satisfies AgentTools;
}
