import type { Group, Message } from "@/state/store";

export function goalMessages(messages: readonly Message[], cardId: string): Message[] {
  const at = messages.findIndex((message) => message.id === cardId);
  if (at < 0) return [];
  const tail = messages.slice(at + 1);
  const next = tail.findIndex((message) => message.kind === "goal.run");
  return next < 0 ? tail : tail.slice(0, next);
}

export function goalReports(group: Group, cardId: string) {
  return goalMessages(group.messages, cardId).flatMap((message) => {
    if (message.kind !== "text" || !message.from || !message.text) return [];
    const role = group.roles?.[message.from.botId];
    if (role !== "tester" && role !== "reviewer") return [];
    const verdict = [...message.text.matchAll(/\bVERDICT:\s*(PASS|FAIL)\b/gi)].at(-1)?.[1]?.toUpperCase();
    return [{ message, role, verdict }];
  });
}
