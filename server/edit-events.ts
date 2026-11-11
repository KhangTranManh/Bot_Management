/** Tool titles engines report for a file edit: Claude Code's Write/Edit/MultiEdit/NotebookEdit and Codex's `edit`.
 * Shell commands that write files are not attributed. */
const EDIT_TITLES = /^(write|edit|multiedit|notebookedit|apply_patch|edit_file|write_file|create_file)$/i;
/** Read from the raw input text, so an input the event log shortened still yields its paths. */
const PATH_FIELD = /"(?:file_path|filePath|notebook_path|path)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

/** Paths a thread's own edit tool calls named since `sinceMs`, with forward slashes. */
export function editedPaths(ndjson: string, sinceMs: number): string[] {
  const found = new Set<string>();
  for (const line of ndjson.split("\n")) {
    if (!line.includes("item.started")) continue;
    let event: { type?: string; createdAt?: string; title?: unknown; input?: unknown };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== "item.started" || Date.parse(event.createdAt ?? "") < sinceMs) continue;
    if (typeof event.title !== "string" || !EDIT_TITLES.test(event.title.trim())) continue;
    const input = typeof event.input === "string" ? event.input : JSON.stringify(event.input ?? "");
    for (const match of input.matchAll(PATH_FIELD)) {
      try {
        found.add((JSON.parse(`"${match[1]}"`) as string).replace(/\\/g, "/"));
      } catch {
        continue;
      }
    }
  }
  return [...found];
}
