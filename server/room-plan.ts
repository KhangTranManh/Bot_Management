import type { GoalBrief } from "../shared/group-goal-run.ts";
import type { GoalPlanSource, PlanWave, RoomPlanDraft } from "../shared/room-plan.ts";
import type { RoomProjectProfile, WireMessage } from "../shared/wire.ts";
import { redactSecretsInText } from "../shared/redact.ts";
import { goalBriefText, parseGoalBrief, goalBriefStructureProblem } from "./goal-brief.ts";
import { ROLE_PLAYBOOKS } from "./playbooks/roles.ts";
import { PROJECT_PLAYBOOKS } from "./playbooks/projects.ts";

export function checkedRoomPlan(raw: unknown): RoomPlanDraft {
  const fail = (detail: string): never => { throw Object.assign(new Error(`plan ${detail}`), { status: 400 }); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("must contain brief and waves");
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["brief", "waves"].includes(key))) return fail("contains an unknown field; do not assign tasks");
  const brief = parseGoalBrief(record.brief);
  if (!brief?.acceptance.length) return fail("needs a brief with observable acceptance checks");
  if (!brief.structure) return fail(goalBriefStructureProblem(record.brief) ?? "needs a structure");
  if (!Array.isArray(record.waves) || !record.waves.length || record.waves.length > 8) return fail("needs 1 to 8 ordered waves");
  const waves: PlanWave[] = [];
  const names = new Set<string>();
  for (const entry of record.waves) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail("each wave needs name, areas and deliverable");
    const wave = entry as Record<string, unknown>;
    if (Object.keys(wave).some((key) => !["name", "areas", "deliverable"].includes(key))) return fail("wave contains an unknown field; do not assign tasks");
    if (typeof wave.name !== "string" || !wave.name.trim() || wave.name.length > 80 || typeof wave.deliverable !== "string" || !wave.deliverable.trim() || wave.deliverable.length > 400) return fail("wave names must be 1-80 characters and deliverables 1-400 characters");
    const name = wave.name.trim();
    if (names.has(name.toLowerCase())) return fail(`repeats wave ${name}`);
    names.add(name.toLowerCase());
    if (!Array.isArray(wave.areas) || !wave.areas.length || wave.areas.length > 12 || wave.areas.some((area) => typeof area !== "string" || !brief.structure!.some((known) => known.name === area))) return fail(`wave ${name} must name areas from the structure`);
    waves.push({ name, areas: [...new Set(wave.areas as string[])], deliverable: wave.deliverable.trim() });
  }
  return { brief, waves };
}

export function parseRoomPlanReply(text: string): { draft: RoomPlanDraft } | { problem: string } {
  const close = text.lastIndexOf("</openmaus-goal>");
  const open = text.lastIndexOf("<openmaus-goal>", close);
  if (close < 0 || open < 0) return { problem: "Return a complete private plan envelope" };
  try { return { draft: checkedRoomPlan(JSON.parse(text.slice(open + "<openmaus-goal>".length, close))) }; }
  catch (error) { return { problem: error instanceof Error ? error.message : "Invalid plan JSON" }; }
}

export function safeRoomPlan(draft: RoomPlanDraft): RoomPlanDraft {
  return JSON.parse(redactSecretsInText(JSON.stringify(draft))) as RoomPlanDraft;
}

export function latestRoomPlan(messages: readonly WireMessage[], profile?: RoomProjectProfile | null): GoalPlanSource | undefined {
  const latest = messages.findLast((message) => message.kind === "room.plan" && message.roomPlan?.status === "ready" && message.roomPlan.draft);
  if (latest?.roomPlan?.draft) return { source: "conversation", cardId: latest.id, draft: structuredClone(latest.roomPlan.draft) };
  return profile?.plan ? { source: "profile", draft: structuredClone(profile.plan) } : undefined;
}

export function roomPlanText(draft: RoomPlanDraft): string {
  return [goalBriefText(draft.brief),
    ...(draft.brief.openQuestions.length ? [`Open questions:\n${draft.brief.openQuestions.map((question) => `- ${question}`).join("\n")}`] : []),
    "Ordered waves:", ...draft.waves.map((wave, index) => `${index + 1}. ${wave.name} [${wave.areas.join(", ")}]: ${wave.deliverable}`),
  ].join("\n");
}

export function goalPlanContext(source: GoalPlanSource): string {
  return `Saved project outline (${source.source}${source.cardId ? `, card ${source.cardId}` : ""}):\n${roomPlanText(source.draft)}\nUse this brief and wave order. A changed brief requires a non-empty planChangeReason in the first task-plan envelope; report the reason to the person. When the person's goal message answers the outline's open questions, send the brief with those questions removed and name the answers in planChangeReason. Research goal-file rules still apply.`;
}

export function changedPlanBrief(original: GoalBrief, next: GoalBrief): boolean {
  return JSON.stringify(original) !== JSON.stringify(next);
}

export function roomPlanInstructions(args: { request: string; roster: string; projectContext?: string; previous?: RoomPlanDraft; problem?: string }): string {
  return [
    "You are the Lead drafting a project outline for the team. Do not start work, edit files or assign tasks.",
    `Request: ${args.request || "Outline the work discussed in this conversation."}`,
    `Available room members: ${args.roster}.`,
    ...(args.projectContext ? [args.projectContext] : []),
    ROLE_PLAYBOOKS.lead,
    ...(args.previous ? [`The latest outline, to revise with the feedback above:\n${roomPlanText(args.previous)}`] : []),
    ...(args.problem ? [`Your previous outline was refused: ${args.problem}. Send the whole outline again, corrected.`] : []),
    "Write a short human-facing summary of the outline, then end with exactly one private envelope on its own line:",
    '<openmaus-goal>{"brief":{"goal":"one sentence","inScope":["…"],"outOfScope":["…"],"acceptance":["observable checks"],"constraints":["…"],"openQuestions":[],"structure":[{"name":"area","paths":["folder/"],"owns":"what it holds","readOnly":false}]},"waves":[{"name":"stage name","areas":["area names from structure"],"deliverable":"what exists when the stage is done"}]}</openmaus-goal>',
    "Waves are ordered stages (1-8); each names areas from the structure and a deliverable. The envelope holds only brief and waves. Never mention or explain the envelope in your human-facing text.",
  ].join("\n");
}

export function profileOutlineContext(profile: RoomProjectProfile | null | undefined): string | undefined {
  if (!profile) return undefined;
  const parts = [
    ...(profile.template ? [PROJECT_PLAYBOOKS[profile.template]] : []),
    ...(profile.instructions ? [`Project conventions:\n${profile.instructions}`] : []),
    ...(profile.moduleMap ? [`Module map:\n${profile.moduleMap}`] : []),
  ];
  return parts.length ? redactSecretsInText(["Room project profile:", ...parts].join("\n")) : undefined;
}
