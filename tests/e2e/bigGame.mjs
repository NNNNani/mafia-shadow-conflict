// Large game: 1 host in a real browser + 21 bot players (22 total) until someone wins.
// Start the server: TIME_SCALE=0.1 PORT=3102 npm start
// Then run:         BASE_URL=http://localhost:3102 node tests/e2e/bigGame.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE_URL = process.env.BASE_URL || "http://localhost:3102";
const BOTS = Number(process.env.BOTS) || 21;
const SHOTS = process.env.SHOTS_DIR || null;
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

const browser = await chromium.launch();
try {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await host.goto(BASE_URL);
  await host.fill("#playerName", "Hôte");
  await host.click("text=Créer une ville");
  await host.waitForSelector("text=La ville se réveille");
  const code = (await host.locator("strong.font-display").first().innerText()).trim();

  // The bots live in a second page: one Socket.IO connection each.
  const botsPage = await browser.newPage();
  await botsPage.goto(BASE_URL);
  await botsPage.evaluate(async ({ code, count }) => {
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    for (let i = 0; i < count; i++) {
      const s = window.io({ forceNew: true });
      await new Promise((r) => s.on("connect", r));
      s.on("room:state", (state) => {
        const me = state.me;
        if (state.phase === "lobby" && !state.players.find((p) => p.id === me.id).ready) {
          s.emit("player:ready", { ready: true }, () => {});
        }
        if (state.phase === "night" && me.night && !me.night.myAction && me.night.targetIds.length) {
          s.emit("night:action", { targetId: pick(me.night.targetIds) }, () => {});
        }
        if (state.phase === "vote" && me.canVote && !me.myVote) {
          const targets = state.players.filter((p) => p.alive && p.id !== me.id);
          s.emit("vote:cast", { targetId: pick(targets).id }, () => {});
        }
      });
      await s.timeout(3000).emitWithAck("room:join", { code, name: `Bot${String(i + 1).padStart(2, "0")}` });
    }
  }, { code, count: BOTS });

  await host.waitForSelector(`text=${BOTS + 1} / `);
  console.log(`• ${BOTS + 1} players in the lobby ✓`);
  await shot(host, "big-1-lobby");

  await host.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Lancer la partie"));
    return b && !b.disabled;
  });
  await host.click("text=🚀 Lancer la partie");
  await host.waitForSelector("text=Nuit · tour 1", { timeout: 20000 });
  await shot(host, "big-2-night");
  console.log("• game started ✓");

  await host.waitForSelector("text=Fin de partie", { timeout: 240000 });
  const banner = await host.locator("h1").first().innerText();
  const roles = await host.locator("ul li").allInnerTexts();
  assert.ok(/a gagné/.test(banner));
  console.log(`• ${banner} ✓ (${roles.length} entries on the end screen)`);
  await shot(host, "big-3-end");
  console.log("\nBIG GAME PASSED");
} catch (error) {
  console.error("\nBIG GAME FAILED:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
