import type { ChildProcess } from "node:child_process";
import { killCliTree } from "../procs.ts";

export async function releaseIdleThread<Session extends { child: ChildProcess; closed?: Promise<void> }>(threadId: string, deps: {
  busy(threadId: string): boolean;
  get(threadId: string): Session | undefined;
  close(threadId: string): void;
  canRelease?(session: Session): boolean;
}): Promise<boolean> {
  if (deps.busy(threadId)) return false;
  const session = deps.get(threadId);
  if (!session) return true;
  if (deps.canRelease && !deps.canRelease(session)) return false;
  deps.close(threadId);
  if (!await killCliTree(session.child)) return false;
  if (session.closed) await session.closed;
  else if (session.child.exitCode === null && session.child.signalCode === null) await new Promise<void>((resolve) => session.child.once("close", () => resolve()));
  return true;
}
