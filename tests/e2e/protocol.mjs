// Protocol test: sends invalid data and out-of-order events straight to the
// server (bypassing the UI) and checks every one is refused cleanly.
// Start the server with MIN_PLAYERS=3, then: BASE_URL=http://localhost:3100 node tests/e2e/protocol.mjs
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://localhost:3100";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE_URL);

const results = await page.evaluate(async () => {
  const out = [];
  const connect = () => new Promise((resolve) => {
    const s = window.io({ forceNew: true });
    s.on("connect", () => resolve(s));
  });
  const ask = (s, event, payload) => s.timeout(3000).emitWithAck(event, payload).catch(() => ({ ok: false, error: "timeout" }));
  const expectRefused = async (label, s, event, payload) => {
    const r = await ask(s, event, payload);
    out.push({ label, pass: r.ok === false, detail: r.error });
  };

  const [a, b, c] = await Promise.all([connect(), connect(), connect()]);
  let stateB = null;
  b.on("room:state", (s) => (stateB = s));

  // Invalid data
  await expectRefused("create without a name", a, "room:create", {});
  await expectRefused("create with a number as name", a, "room:create", { name: 42 });
  await expectRefused("join an unknown room", b, "room:join", { code: "ZZZZZZ", name: "Bob" });
  await expectRefused("payload is a string", a, "room:join", "garbage");
  await expectRefused("chat before joining", a, "chat:send", { channel: "lobby", text: "hi" });

  // Wrong order: game actions in the lobby
  const created = await ask(a, "room:create", { name: "Ana" });
  out.push({ label: "create room", pass: created.ok });
  const code = created.data.code;
  await ask(b, "room:join", { code, name: "Bob" });
  await ask(c, "room:join", { code, name: "Cid" });
  await expectRefused("vote in the lobby", b, "vote:cast", { targetId: "x" });
  await expectRefused("night action in the lobby", b, "night:action", { targetId: "x" });
  await expectRefused("non-host starts the game", b, "game:start", {});
  await expectRefused("start while players are not ready", a, "game:start", {});
  await expectRefused("non-host changes settings", b, "room:settings", { settings: { nightSeconds: 20 } });
  await expectRefused("settings out of bounds", a, "room:settings", { settings: { nightSeconds: 9999 } });
  await expectRefused("unknown chat channel", b, "chat:send", { channel: "admin", text: "hi" });
  await expectRefused("mafia channel from the lobby", b, "chat:send", { channel: "mafia", text: "hi" });
  await expectRefused("empty message", b, "chat:send", { channel: "lobby", text: "    " });
  await expectRefused("resume with a fake session", c, "room:resume", { sessionId: "not-a-session" });

  // Start, then actions in the wrong phase
  await ask(b, "player:ready", { ready: true });
  await ask(c, "player:ready", { ready: true });
  const start = await ask(a, "game:start", {});
  out.push({ label: "host starts when everyone is ready", pass: start.ok, detail: start.error });
  await expectRefused("join a game already started", (await connect()), "room:join", { code, name: "Dan" });
  await expectRefused("vote during role reveal", b, "vote:cast", { targetId: stateB.players[0].id });
  await expectRefused("restart a running game", a, "game:restart", {});
  await expectRefused("lobby chat during the game", b, "chat:send", { channel: "lobby", text: "hi" });

  // Disconnection: B leaves for good -> counted dead
  b.disconnect();
  await new Promise((r) => setTimeout(r, 300));
  out.push({ label: "server still answers after a disconnect", pass: (await ask(a, "player:ready", { ready: true })).ok === false });
  return out;
});

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? "✓" : "✗"} ${r.label}${r.detail ? `  (${r.detail})` : ""}`);
}
console.log(failed ? `\nPROTOCOL FAILED (${failed})` : "\nPROTOCOL PASSED");
process.exitCode = failed ? 1 : 0;
await browser.close();
