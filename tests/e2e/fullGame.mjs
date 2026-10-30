// End-to-end test: 5 real browser sessions play a full game through the Arabic UI.
// Needs Playwright (npm i -D playwright && npx playwright install chromium).
// Start the server first:  TIME_SCALE=0.25 PORT=3100 npm start
// Then run:                BASE_URL=http://localhost:3100 node tests/e2e/fullGame.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE_URL = process.env.BASE_URL || "http://localhost:3100";
const SHOTS = process.env.SHOTS_DIR || null;
const NAMES = ["Amine", "Badr", "Chama", "Driss", "Enzo"];
const ROLE_NAMES = ["مستذئب", "المحقق", "الطبيب", "قروي"];
const MESSAGE = 'input[aria-label="رسالة"]';

const browser = await chromium.launch();
const players = [];
const log = (...args) => console.log("•", ...args);

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function open(name, width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`[${name}] page error:`, e.message));
  await page.goto(BASE_URL);
  await page.fill("#playerName", name);
  return { name, page };
}

const board = (page) => page.locator('ul[aria-label="اللاعبون"]');
const card = (page, name) => board(page).locator("li").filter({ hasText: name }).first();
const roleText = (page) => page.locator('section[aria-label="دوري"]').innerText();
const say = async (p, text) => {
  await p.page.fill(MESSAGE, text);
  await p.page.press(MESSAGE, "Enter");
};

try {
  // ---------------------------------------------------------- lobby
  const host = await open(NAMES[0]);
  await host.page.click("text=إنشاء قرية");
  await host.page.waitForSelector("text=القرية تستيقظ");
  const code = (await host.page.locator("strong.font-display").first().innerText()).trim();
  log("room created", code);
  players.push(host);

  for (const name of NAMES.slice(1)) {
    const p = await open(name, name === "Enzo" ? 390 : 1280); // Enzo plays on a phone-sized screen
    await p.page.fill("#roomCode", code);
    await p.page.click("text=انضمام");
    await p.page.waitForSelector("text=القرية تستيقظ");
    players.push(p);
  }

  const dup = await open("amine");
  await dup.page.fill("#roomCode", code);
  await dup.page.click("text=انضمام");
  await dup.page.waitForSelector("text=هذا الاسم مستخدم");
  log("duplicate name refused ✓");
  await dup.page.context().close();

  const start = host.page.locator("text=🚀 ابدأ اللعبة");
  assert.equal(await start.isDisabled(), true);
  for (const p of players.slice(1)) await p.page.click("text=✓ أنا جاهز");

  await say(players[1], "مرحبا بالجميع <b>!</b>");
  await host.page.waitForSelector("text=مرحبا بالجميع <b>!</b>");
  log("lobby chat delivered, HTML shown as text ✓");
  await shot(host.page, "1-lobby");

  await host.page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("ابدأ اللعبة"));
    return b && !b.disabled;
  });
  await start.click();

  // ---------------------------------------------------------- roles
  await host.page.waitForSelector("text=دورك السري");
  await shot(host.page, "2-role-reveal");
  for (const p of players) {
    p.role = (await roleText(p.page)).split("\n").map((l) => l.trim()).find((l) => ROLE_NAMES.includes(l));
  }
  log("roles:", players.map((p) => `${p.name}=${p.role}`).join(", "));
  const wolf = players.find((p) => p.role === "مستذئب");
  const doctor = players.find((p) => p.role === "الطبيب");
  const detective = players.find((p) => p.role === "المحقق");
  const villagers = players.filter((p) => p.role === "قروي");
  assert.ok(wolf && doctor && detective && villagers.length === 2, "5-player deck: 1 wolf, detective, doctor, 2 villagers");

  // ---------------------------------------------------------- night 1
  await host.page.waitForSelector("text=الليل · الجولة 1", { timeout: 15000 });

  await say(wolf, "secret wolf plan");
  await wolf.page.waitForSelector("text=secret wolf plan");
  for (const p of players.filter((x) => x !== wolf)) {
    assert.equal(await p.page.locator("text=secret wolf plan").count(), 0, `${p.name} must not see the wolves' chat`);
  }
  log("wolves chat private ✓");
  assert.equal(await villagers[0].page.locator(MESSAGE).isDisabled(), true);

  const victim = villagers[0];
  await card(wolf.page, victim.name).click();
  await wolf.page.click("text=تأكيد");
  await card(doctor.page, villagers[1].name).click();
  await doctor.page.click("text=تأكيد");
  await shot(detective.page, "3-night-detective");
  await card(detective.page, wolf.name).click();
  await detective.page.click("text=تأكيد");

  await detective.page.waitForSelector("text=نتيجة التحقيق");
  assert.match(await detective.page.locator('[role="dialog"]').innerText(), /مستذئب!/);
  await detective.page.click("text=فهمت");
  log("detective found the werewolf (private modal) ✓");

  // ---------------------------------------------------------- day 1
  await host.page.waitForSelector(`text=/${victim.name}.*افترسته الذئاب/`, { timeout: 15000 });
  log(`${victim.name} killed by the werewolves ✓`);
  await shot(host.page, "4-dawn");

  await detective.page.reload();
  await detective.page.waitForSelector('section[aria-label="دوري"]');
  assert.match(await roleText(detective.page), /المحقق/);
  log("refresh -> same seat and role ✓");

  await host.page.waitForSelector("text=النقاش مفتوح", { timeout: 15000 });
  await say(detective, `${wolf.name} هو المستذئب!`);
  await host.page.waitForSelector(`text=${wolf.name} هو المستذئب!`);
  assert.equal(await victim.page.locator(MESSAGE).isDisabled(), true);
  log("dead player muted in village ✓");
  await shot(players[4].page, "5-discussion-mobile");

  await host.page.click("text=⏭️ الانتقال إلى التصويت"); // the host keeps this power even when dead

  // ---------------------------------------------------------- vote
  const living = players.filter((p) => p !== victim);
  await living[0].page.waitForSelector("text=من يجب أن يغادر القرية؟");
  for (const voter of living.filter((p) => p !== wolf)) {
    await card(voter.page, wolf.name).click();
    await voter.page.click("text=تأكيد التصويت");
  }
  await shot(living[0].page, "6-vote");
  // With fast test timers the vote may already be closed: the majority still wins.
  if (await wolf.page.locator("text=من يجب أن يغادر القرية؟").count()) {
    const target = living.find((p) => p !== wolf);
    await card(wolf.page, target.name).click({ timeout: 5000 }).catch(() => {});
    await wolf.page.click("text=تأكيد التصويت", { timeout: 5000 }).catch(() => {});
  }

  // ---------------------------------------------------------- end
  await host.page.waitForSelector("text=فاز القرويون", { timeout: 15000 });
  log("villagers win after voting out the werewolf ✓");
  await shot(host.page, "7-end");

  await host.page.click("text=لعبة جديدة");
  await host.page.waitForSelector("text=القرية تستيقظ");
  log("restart -> back to lobby ✓");

  console.log("\nE2E PASSED");
} catch (error) {
  console.error("\nE2E FAILED:", error.message);
  for (const p of players) await shot(p.page, `fail-${p.name}`).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
