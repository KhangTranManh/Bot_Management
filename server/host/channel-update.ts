import { join } from "node:path";
import { isTeamRole, type TeamRole } from "../../shared/team-roles.ts";
import { validateBotCwd } from "../bot-cwd.ts";
import { fitsOnOneLine } from "../bot-profile.ts";
import { branchPaths } from "../goal-branches.ts";
import { loadResearchGoal } from "../research-goal.ts";
import { checkedProjectProfile } from "../room-project.ts";
import { parseConversationTurnTimeout } from "../room-turn-timeout.ts";
import type { RoutineManager } from "../routines.ts";
import { checkedGroupResponder } from "../routes/groups.ts";
import type { GroupRecord, Store } from "../store.ts";
import { userError, userErrorFields } from "../user-errors.ts";
import { checkedVerifyCommands } from "../verify-config.ts";

export interface ChannelUpdateDeps {
  store: Store;
  routines(): RoutineManager | null;
  phoneSecretSubmissions: { hasGroup(groupId: string): boolean };
  channelTaskBlocked(group: GroupRecord): boolean;
  checkedMemberIds(value: unknown): { ok: true; memberIds: string[] } | { ok: false; error: string };
  roomAudienceConflict(memberIds: readonly string[], existing?: readonly string[]): string | null;
  audienceChanged(): void;
}

/** A room's roles as the person set them: member ids only, known roles only, at most one lead; none means undefined. */
function checkedTeamRoles(value: unknown, memberIds: readonly string[]): Record<string, TeamRole> | undefined {
  const refuse = (message: string) => Object.assign(new Error(message), { status: 400 });
  if (value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw refuse("roles must map member ids to lead, worker, tester or reviewer");
  const roles: Record<string, TeamRole> = {};
  for (const [botId, role] of Object.entries(value)) {
    if (!memberIds.includes(botId)) throw refuse("roles may name only members of this room");
    if (!isTeamRole(role)) throw refuse("roles must map member ids to lead, worker, tester or reviewer");
    roles[botId] = role;
  }
  if (Object.values(roles).filter((role) => role === "lead").length > 1) throw refuse("a room has at most one lead");
  return Object.keys(roles).length > 0 ? roles : undefined;
}

/** Applies a room PATCH after checking every field it names; throws an Error with `status` for the reply. */
export function createChannelUpdate({
  store, routines, phoneSecretSubmissions, channelTaskBlocked, checkedMemberIds, roomAudienceConflict, audienceChanged,
}: ChannelUpdateDeps) {
  function updateChannel(groupId: string, value: unknown): GroupRecord {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw Object.assign(new Error("body must be a JSON object"), { status: 400 });
    }
    const body = value as Record<string, unknown>;

    const existing = store.group(groupId);
    if (!existing) throw Object.assign(new Error("no such room"), { status: 404 });
    if (body.memberIds !== undefined && phoneSecretSubmissions.hasGroup(existing.id)) {
      throw Object.assign(new Error("this channel is securely saving a credential — try again when it finishes"), { status: 409 });
    }
    if (
      channelTaskBlocked(existing) &&
      (body.memberIds !== undefined || body.defaultResponder !== undefined || body.bulletin !== undefined)
    ) {
      throw Object.assign(new Error("this channel is working or waiting on you — finish that turn first"), { status: 409 });
    }
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string") throw Object.assign(new Error("room name must be a string"), { status: 400 });
      const name = body.name.trim();
      if (!name) throw Object.assign(new Error("room name must not be empty"), { status: 400 });
      if (name.length > 100) throw Object.assign(new Error("room name must be at most 100 characters"), { status: 400 });
      if (!fitsOnOneLine(name)) throw Object.assign(Object.assign(new Error("room name must fit on one line"), userErrorFields(userError("serverError.room.nameOneLine"))), { status: 400 });
      patch.name = name;
    }
    if (body.bulletin !== undefined) {
      if (typeof body.bulletin !== "string") throw Object.assign(new Error("bulletin must be a string"), { status: 400 });
      if (body.bulletin.length > 12_000) {
        throw Object.assign(new Error("bulletin must be at most 12000 characters"), { status: 400 });
      }
      patch.bulletin = body.bulletin;
    }
    if (body.description !== undefined) {
      if (typeof body.description !== "string") throw Object.assign(new Error("description must be a string"), { status: 400 });
      const trimmed = body.description.trim();
      if (!trimmed) patch.description = undefined;
      else if (/[\n\r]/.test(trimmed)) throw Object.assign(new Error("description must be a single line"), { status: 400 });
      else if (trimmed.length > 120) throw Object.assign(new Error("description must be at most 120 characters"), { status: 400 });
      else patch.description = trimmed;
    }
    if (body.unread !== undefined) {
      if (typeof body.unread !== "boolean") throw Object.assign(new Error("unread must be true or false"), { status: 400 });
      patch.unread = body.unread;
    }
    if (body.memberIds !== undefined) {
      if (existing.dm) throw Object.assign(new Error("direct-message channels cannot change members"), { status: 400 });
      const roster = checkedMemberIds(body.memberIds);
      if (!roster.ok) throw Object.assign(new Error(roster.error.replace("channel", "room")), { status: 400 });
      const audienceConflict = roomAudienceConflict(roster.memberIds, existing.memberIds);
      if (audienceConflict) throw Object.assign(new Error(audienceConflict), { status: 400 });
      const removedGoalLead = routines()!.listRoutines().some(
        (routine) =>
          routine.enabled &&
          routine.target === "room-goal" &&
          routine.groupId === existing.id &&
          !roster.memberIds.includes(routine.botId),
      ) || routines()!.listRuns().some(
        (run) =>
          run.target === "room-goal" &&
          run.groupId === existing.id &&
          ["queued", "running", "waiting"].includes(run.status) &&
          !roster.memberIds.includes(run.botId),
      );
      if (removedGoalLead) {
        throw Object.assign(new Error("pause or reassign this room's team-goal routine before removing its lead"), { status: 409 });
      }
      patch.memberIds = roster.memberIds;
    }
    if (body.defaultResponder !== undefined) {
      const memberIds = (patch.memberIds as string[] | undefined) ?? existing.memberIds;
      const responder = checkedGroupResponder(body.defaultResponder, memberIds);
      if (!responder) throw Object.assign(new Error("invalid default responder"), { status: 400 });
      patch.defaultResponder = responder;
    }
    if (body.roles !== undefined) {
      const memberIds = (patch.memberIds as string[] | undefined) ?? existing.memberIds;
      patch.roles = checkedTeamRoles(body.roles, memberIds);
    }
    if (body.autoGoal !== undefined) {
      if (body.autoGoal !== null && typeof body.autoGoal !== "boolean") throw Object.assign(new Error("autoGoal must be true, false or null"), { status: 400 });
      patch.autoGoal = body.autoGoal ?? undefined;
    }
    if (body.goalWaves !== undefined) {
      if (typeof body.goalWaves !== "boolean") throw Object.assign(new Error("goalWaves must be true or false"), { status: 400 });
      patch.goalWaves = body.goalWaves ? undefined : false;
    }
    if (body.kind !== undefined) {
      if (body.kind === null) patch.kind = undefined;
      else if (body.kind === "code" || body.kind === "research") patch.kind = body.kind;
      else throw Object.assign(new Error("kind must be code or research"), { status: 400 });
    }
    if (body.goalFile !== undefined) {
      if (body.goalFile === null) {
        patch.goalFile = undefined;
        patch.goalFileHash = undefined;
      } else if (typeof body.goalFile === "string" && body.goalFile.trim() && !body.goalFile.includes("..") && !/^[A-Za-z]:|^[/\\]/.test(body.goalFile.trim())) {
        patch.goalFile = body.goalFile.trim();
        patch.goalFileHash = undefined; // A new file must be approved again before a research goal may run.
      } else {
        throw Object.assign(new Error("goalFile must be a relative path inside the room's working folder"), { status: 400 });
      }
    }
    if (body.researchGoalApprove !== undefined) {
      if (body.researchGoalApprove !== true) throw Object.assign(new Error("researchGoalApprove must be true"), { status: 400 });
      if ((patch.kind ?? existing.kind) !== "research") throw Object.assign(new Error("only a research room approves a goal file"), { status: 409 });
      const goalFile = (patch.goalFile as string | undefined) ?? existing.goalFile;
      if (!goalFile) throw Object.assign(new Error("set goalFile on the room before approving it"), { status: 400 });
      const folder = store.pinGroupCwd(groupId) ?? existing.cwd;
      if (!folder) throw Object.assign(new Error("the research room needs a working folder before its goal file can be approved"), { status: 409 });
      const loaded = loadResearchGoal(join(folder, goalFile));
      if (!loaded.ok) throw Object.assign(new Error(loaded.error), { status: 400 });
      patch.goalFileHash = loaded.hash;
    }
    if (body.verify !== undefined) {
      patch.verify = body.verify === null ? undefined : checkedVerifyCommands(body.verify);
    }
    if (body.isolatedBranches !== undefined) {
      if (typeof body.isolatedBranches !== "boolean" || existing.dm) throw Object.assign(new Error("isolatedBranches must be a boolean on a room"), { status: 400 });
      if (channelTaskBlocked(existing)) throw Object.assign(new Error("Stop the room before changing isolated branches"), { status: 409 });
      if (body.isolatedBranches && (body.kind ?? existing.kind) === "research") throw Object.assign(new Error("Isolated branches are disabled for research rooms"), { status: 400 });
      patch.isolatedBranches = body.isolatedBranches;
    }
    if (body.kind === "research") patch.isolatedBranches = false;
    if (body.branchFiles !== undefined) {
      if (existing.dm || channelTaskBlocked(existing)) throw Object.assign(new Error("Stop the room before changing worktree files"), { status: 409 });
      if (!Array.isArray(body.branchFiles) || body.branchFiles.length > 16 || body.branchFiles.some((path) => typeof path !== "string" || path.length > 200)) throw Object.assign(new Error("branchFiles must be at most 16 relative paths"), { status: 400 });
      try { patch.branchFiles = branchPaths(body.branchFiles); } catch { throw Object.assign(new Error("branchFiles must stay inside the room folder and exclude .git"), { status: 400 }); }
    }
    if (body.projectProfile !== undefined) {
      if (existing.dm) throw Object.assign(new Error("direct-message channels cannot have a project profile"), { status: 400 });
      patch.projectProfile = body.projectProfile === null ? undefined : checkedProjectProfile(body.projectProfile);
    }
    if (Object.prototype.hasOwnProperty.call(body, "turnTimeoutMinutes")) {
      if (!existing.dm) {
        throw Object.assign(new Error("set the turn limit on that conversation"), { status: 400 });
      }
      const parsed = parseConversationTurnTimeout(body.turnTimeoutMinutes);
      if (!parsed.ok) throw Object.assign(new Error(parsed.error), { status: 400 });
      patch.turnTimeoutMinutes = parsed.minutes;
    }
    if (body.cwd !== undefined) {
      if (existing.dm) throw Object.assign(new Error("direct-message channels cannot have a working folder"), { status: 400 });
      if (existing.pinnedCwd !== undefined) {
        throw Object.assign(new Error("the room's working folder is fixed after its first turn"), { status: 409 });
      }
      const checked = validateBotCwd(body.cwd);
      if (!checked.ok) throw Object.assign(new Error(checked.error), { status: 400 });
      patch.cwd = checked.cwd ?? undefined;
    }
    if (body.pinnedMessageId !== undefined) {
      if (body.pinnedMessageId === null || body.pinnedMessageId === "") patch.pinnedMessageId = undefined;
      else if (typeof body.pinnedMessageId === "string" && /^[\w-]+$/.test(body.pinnedMessageId)) {
        patch.pinnedMessageId = body.pinnedMessageId;
      } else throw Object.assign(new Error("pinnedMessageId must be a message id"), { status: 400 });
    }
    if (body.section !== undefined) {
      if (body.section === null) patch.section = undefined;
      else if (typeof body.section !== "string") throw Object.assign(new Error("section must be a string"), { status: 400 });
      else {
        const trimmed = body.section.trim();
        if (!trimmed) patch.section = undefined;
        else if (trimmed.length > 60) throw Object.assign(new Error("section must be at most 60 characters"), { status: 400 });
        else patch.section = trimmed;
      }
    }
    // Admin-only, and the only way a room's floor widens; a Chief's PATCH never has it.
    const resetAudience = body.resetAudience !== undefined;
    if (resetAudience) {
      if (body.resetAudience !== true) throw Object.assign(new Error("resetAudience must be true"), { status: 400 });
      patch.audienceFloor = undefined;
    }
    const group = store.patchGroup(groupId, patch);
    if (resetAudience) audienceChanged();
    if (!group) throw Object.assign(new Error("no such room"), { status: 404 });
    return group;
  }

  return { updateChannel };
}
