/** The retained Git work of a goal; decisions apply only to the exact head shown on the card. */
export interface GoalBranchCard {
  runId: string;
  branch: string;
  head: string;
  originalBranch: string | null;
  decision: "pending" | "kept" | "merged" | "discarded";
  tasks: Array<{
    key: string;
    taskId: string;
    botId: string;
    branch: string;
    phase: string;
    changed: string[];
    outsideWrites: string[];
    conflicts: string[];
  }>;
}
