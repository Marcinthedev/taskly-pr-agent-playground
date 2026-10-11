export interface FileChange {
  path: string;
  status: string;
}

export function parseNameStatus(output: string): FileChange[] {
  const tokens = output.split("\0").filter((token) => token !== "");
  const changes: FileChange[] = [];
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index].charAt(0);
    const isRenameOrCopy = status === "R" || status === "C";
    changes.push({ status, path: tokens[index + (isRenameOrCopy ? 2 : 1)] });
    index += isRenameOrCopy ? 3 : 2;
  }
  return changes;
}

export function parsePorcelainStatus(output: string): FileChange[] {
  const entries = output.split("\0").filter((entry) => entry !== "");
  const changes: FileChange[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const code = entries[index].slice(0, 2);
    const file = entries[index].slice(3);
    let status = "M";
    if (code.includes("D")) status = "D";
    else if (code.includes("R") || code.includes("C")) {
      status = "R";
      index += 1;
    } else if (code === "??" || code.includes("A")) status = "A";
    changes.push({ status, path: file });
  }
  return changes;
}

export function filesInPatch(patch: string): FileChange[] {
  const sections = patch.split(/^(?=diff --git )/m).filter((section) => section.startsWith("diff --git "));
  return sections.map((section) => {
    const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(section);
    let status = "M";
    if (/^deleted file mode /m.test(section)) status = "D";
    else if (/^(rename|copy) (from|to) /m.test(section) || (header && header[1] !== header[2])) status = "R";
    else if (/^(GIT binary patch|Binary files )/m.test(section)) status = "B";
    else if (/^(old mode|new mode) /m.test(section) || /^new file mode (?!100644)/m.test(section)) status = "X";
    else if (/^new file mode 100644/m.test(section)) status = "A";
    return { status, path: header ? header[2] : "" };
  });
}
