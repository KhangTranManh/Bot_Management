/** What one room member is doing right now: the job it runs or waits to run, where, since when, and its newest step. */
export interface MemberNow {
  botId: string;
  state: "running" | "queued";
  task: string;
  threadId: string;
  since?: number;
  step?: string;
  stepOk?: boolean;
}
