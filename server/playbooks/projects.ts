import type { ProjectTemplate } from "../../shared/project-template.ts";

export const PROJECT_PLAYBOOKS: Record<ProjectTemplate, string> = {
  web: `Project template: Web full-stack
Suggested areas: db for schema and migrations; backend for API and services; frontend for UI.
Keep independent contract tests in a read-only tests area when supplied by the project.
Use the repository's real paths; do not overlap a parent area with a child area.
Agree API and data contracts before parallel backend and frontend implementation.
Keep database access out of the frontend and presentation logic out of database modules.
Suggest build, behaviour tests, import-boundary checks and line/file length checks.
Use configured server verify commands as completion gates; report any missing checks.`,
  ml: `Project template: ML training
Suggested areas: data, model, training, read-only eval, and experiments for configurations and results.
Keep held-out samples and independent evaluation scripts out of Worker writes.
Schedule data preparation before training and training before dependent evaluation.
Record data provenance, split definitions, seeds, configurations and metric artifacts.
Start with a small dataset and a one-epoch smoke run within the approved compute budget.
Check configuration validity, reproducibility and that evaluation runs on the produced checkpoint.
Suggest explicit smoke-train and evaluation verify commands; do not invent a passing metric.
Ask about missing data, compute access or an acceptance threshold when it blocks work.`,
  research: `Project template: Research
Suggested areas: read-only data/heldout, src for methods, runs for artifacts, and report for conclusions.
Use disjoint paths for writable data and held-out data; never assign a parent covering both.
Follow the approved research goal file, budget, stopping rules and evaluation protocol.
Schedule experiments from a reproducible baseline and keep configurations, seeds and raw results.
Do not tune on held-out results or change the preregistered evaluation to make results pass.
Keep claims tied to produced artifacts and distinguish observations from hypotheses.
Suggest protocol, area-boundary and reproducibility checks using the configured verification tools.
The template is guidance; it does not replace research-room approval or evaluator rules.`,
  library: `Project template: Library / CLI
Suggested areas: src for implementation, tests for editable tests, and docs for public usage.
Keep externally supplied contract tests in a separate read-only area when present.
Define public API, CLI arguments, output, exit codes and compatibility requirements before implementation.
Keep parsing, core behaviour and presentation in focused modules.
Schedule documentation and dependent integration checks after the relevant interface is defined.
Suggest build, tests, lint and public API or CLI compatibility checks.
Cover malformed input and error exits as well as successful calls.
Use repository tooling and configured server verify commands; name any missing evidence.`,
};
