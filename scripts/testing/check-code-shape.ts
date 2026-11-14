import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const SKIPPED = new Set(["node_modules", "dist", "build", ".git", "coverage"]);
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

export interface CodeShapeLimits {
  maxLine: number;
  maxFile: number;
  /** `from` may not import anything inside `to`; both are folders relative to the project. */
  forbid: Array<{ from: string; to: string }>;
}

function codeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIPPED.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? codeFiles(path) : CODE.test(name) ? [path] : [];
  });
}

const inside = (path: string, folder: string) => path === folder || path.startsWith(folder + sep);

export function checkCodeShape(project: string, limits: CodeShapeLimits): string[] {
  const root = resolve(project);
  const problems: string[] = [];
  for (const file of codeFiles(root)) {
    const name = relative(root, file).split(sep).join("/");
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    if (lines.length > limits.maxFile) problems.push(`${name}: ${lines.length} lines, at most ${limits.maxFile}`);
    const long = lines.findIndex((line) => line.length > limits.maxLine);
    if (long >= 0) problems.push(`${name}:${long + 1}: ${lines[long]!.length} characters, at most ${limits.maxLine}`);
    for (const rule of limits.forbid) {
      if (!inside(file, resolve(root, rule.from))) continue;
      for (const match of text.matchAll(IMPORT)) {
        const target = match[1]!.startsWith(".") ? resolve(dirname(file), match[1]!) : undefined;
        if (target && inside(target, resolve(root, rule.to))) problems.push(`${name}: imports ${match[1]}, but ${rule.from} may not import from ${rule.to}`);
      }
    }
  }
  return problems;
}

function main(argv: string[]): number {
  const [project, ...flags] = argv;
  if (!project) {
    console.error("usage: check-code-shape.ts <project> [--max-line 120] [--max-file 300] [--forbid from=to]...");
    return 2;
  }
  const limits: CodeShapeLimits = { maxLine: 120, maxFile: 300, forbid: [] };
  for (let at = 0; at < flags.length; at += 2) {
    const value = flags[at + 1] ?? "";
    if (flags[at] === "--max-line") limits.maxLine = Number(value);
    else if (flags[at] === "--max-file") limits.maxFile = Number(value);
    else if (flags[at] === "--forbid") limits.forbid.push({ from: value.split("=")[0]!, to: value.split("=")[1]! });
    else { console.error(`unknown flag ${flags[at]}`); return 2; }
  }
  const problems = checkCodeShape(project, limits);
  for (const problem of problems) console.log(problem);
  console.log(problems.length ? `${problems.length} problem(s)` : "code shape ok");
  return problems.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
