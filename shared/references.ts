export type ReferenceStatus = "reviewing" | "applied" | "rejected";

export type AppliedReference = {
  id: string;
  name: string;
  url: string;
  license: string;
  status: ReferenceStatus;
  /** Techniques taken from the source, in our own words. */
  took: string[];
  /** Techniques read and deliberately not taken, with the reason. */
  leftOut: string[];
  /** Repository files that carry the applied technique. */
  appliedIn: string[];
  /** What has been shown so far about the effect; empty until a check ran. */
  evidence: string;
  date: string;
};

export const REFERENCES: readonly AppliedReference[] = [
  {
    id: "ponytail",
    name: "Ponytail",
    url: "https://github.com/DietrichGebert/ponytail",
    license: "MIT",
    status: "applied",
    took: [
      "Smallest complete change: skip what the task does not need, reuse what the repository has, prefer the standard library to a new dependency",
      "List every place a change must reach before writing",
      "Bug fix: search every caller and fix the root cause once",
      "Never cut validation, data-loss handling, security or accessibility",
      "End the report with what was skipped or not checked",
      "Review the code a change touches, not only the diff",
    ],
    leftOut: [
      "shortcut: comments, which the repository comment rules forbid",
      "ultra level that questions the request",
      "Fewest lines as the goal, which risks the compressed code the code-shape check rejects",
      "Band, board and gain commands, which only exist in Claude Code",
    ],
    appliedIn: ["server/playbooks/roles.ts"],
    evidence: "Netflix rerun with the new playbooks: 2,447 source lines against 2,865 before, same readability limits kept, tests and build pass. One run each, with fewer tests (25 against 49), so a hint and not proof.",
    date: "2026-11-15",
  },
  {
    id: "understand-anything",
    name: "Understand Anything",
    url: "https://github.com/Egonex-AI/Understand-Anything",
    license: "MIT",
    status: "applied",
    took: [
      "Lead maps an existing project first: entry points, layers, data flow, searching instead of reading whole files",
      "One-hop impact: whatever imports or calls a changed file goes to the same or a later task",
      "Check a saved map or outline against the current code before trusting it",
    ],
    leftOut: [
      "Plugin install, installer script and auto-update hook: nothing third-party runs here",
      "The generated knowledge graph and dashboard: only the Lead's way of working is taken; a graph tool is a later decision",
    ],
    appliedIn: ["server/playbooks/roles.ts"],
    evidence: "Playbook tests pass. Not yet tried on an existing project: try it on a small repository, then Ciel.",
    date: "2026-11-15",
  },
];
