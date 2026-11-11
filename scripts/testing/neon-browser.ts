import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitForExit } from "../../server/testing/cleanup.ts";

export async function neonBrowser(profile: string, executable: string) {
  mkdirSync(profile, { recursive: true });
  const child = spawn(executable, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--password-store=basic", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + 20_000;
  while (!existsSync(portFile)) {
    if (child.exitCode !== null || Date.now() > deadline) { await waitForExit(child, { signal: "SIGTERM" }); throw new Error("Isolated Chrome did not start"); }
    await new Promise((done) => setTimeout(done, 100));
  }
  const port = readFileSync(portFile, "utf8").split(/\r?\n/)[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const socket = new WebSocket(pages.find((page) => page.type === "page")!.webSocketDebuggerUrl);
  await new Promise<void>((done, fail) => { socket.onopen = () => done(); socket.onerror = () => fail(new Error("Isolated Chrome connection failed")); });
  let sequence = 0;
  const pending = new Map<number, { done(value: any): void; fail(error: Error): void }>();
  const logs: unknown[] = [];
  socket.onmessage = (event) => {
    const value = JSON.parse(String(event.data));
    if (value.id) {
      const request = pending.get(value.id); pending.delete(value.id);
      if (value.error) request?.fail(new Error(value.error.message)); else request?.done(value.result);
    } else if (value.method === "Runtime.consoleAPICalled") logs.push({ type: value.params.type, args: value.params.args.map((arg: any) => arg.value ?? arg.description) });
    else if (value.method === "Runtime.exceptionThrown") logs.push({ type: "error", details: value.params.exceptionDetails });
  };
  const send = (method: string, params: Record<string, unknown> = {}): Promise<any> => new Promise((done, fail) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`${method} timed out`)); }, 25_000);
    pending.set(id, { done: (value) => { clearTimeout(timer); done(value); }, fail: (error) => { clearTimeout(timer); fail(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send("Runtime.enable"); await send("Page.enable");
  const command = async (args: string[]): Promise<Record<string, any>> => {
    if (args[0] === "open") { await send("Page.navigate", { url: args[1] }); return {}; }
    if (args[0] === "eval") {
      const result = await send("Runtime.evaluate", { expression: args[1], awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return { result: result.result.value };
    }
    if (args[0] === "set" && args[1] === "viewport") {
      await send("Emulation.setDeviceMetricsOverride", { width: Number(args[2]), height: Number(args[3]), deviceScaleFactor: Number(args[4] ?? 1), mobile: Number(args[2]) < 640 });
      await send("Emulation.setTouchEmulationEnabled", { enabled: Number(args[2]) < 640 });
      return {};
    }
    if (args[0] === "screenshot") {
      const value = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(args[1], Buffer.from(value.data, "base64")); return {};
    }
    if (args[0] === "console") return { logs };
    if (args[0] === "close") {
      await send("Browser.close").catch(() => {}); socket.close(); await waitForExit(child, { signal: "SIGTERM" }); return {};
    }
    throw new Error(`Unsupported smoke-browser command: ${args[0]}`);
  };
  return command;
}
