// Real server; the room's kind field (B1) round-trips through PATCH and the wire, and refuses junk.
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";

it("a room's kind round-trips, clears, and refuses values that are not code or research", async () => {
  const fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, { scripted: true });
  const { url } = fixture.info;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, { method,
      headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, body: await response.json() as any } as { status: number; body: any };
  };
  const groups = async () => (await api("GET", "/api/bots")).body.groups as any[];
  try {
    const bot = (await api("POST", "/api/bots")).body.bot;
    const room = (await api("POST", "/api/groups", { name: "Research lab", memberIds: [bot.id] })).body.group;
    expect(room.kind).toBeUndefined();

    const set = await api("PATCH", `/api/groups/${room.id}`, { kind: "research" });
    expect(set.status).toBe(200);
    expect((await groups()).find((group: any) => group.id === room.id).kind).toBe("research");
    expect((await api("PATCH", `/api/groups/${room.id}`, { kind: "code" })).status).toBe(200);

    const bad = await api("PATCH", `/api/groups/${room.id}`, { kind: "banana" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/kind must be code or research/);

    expect((await api("PATCH", `/api/groups/${room.id}`, { kind: null })).status).toBe(200);
    expect((await groups()).find((group: any) => group.id === room.id).kind).toBeUndefined();
  } finally {
    await fixture.close();
  }
}, 60_000);
