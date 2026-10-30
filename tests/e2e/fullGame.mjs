// End-to-end test: 5 real browser sessions play a full game through the UI.
// Needs Playwright (npm i -D playwright && npx playwright install chromium).
// Start the server first:  TIME_SCALE=0.25 PORT=3100 npm start
// Then run:                BASE_URL=http://localhost:3100 node tests/e2e/fullGame.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE_URL = process.env.BASE_URL || "http://localhost:3100";
const SHOTS = process.env.SHOTS_DIR || null;
const NAMES = ["Alba", "Bruno", "Cyra", "Dario", "Elio"];

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

const board = (page) => page.locator('ul[aria-label="Joueurs"]');
const card = (page, name) => board(page).locator("li").filter({ hasText: name }).first();
const roleText = (page) => page.locator('section[aria-label="Mon rôle"]').innerText();

try {
  // ---------------------------------------------------------- lobby
  const host = await open(NAMES[0]);
  await host.page.click("text=Créer une ville");
  await host.page.waitForSelector("text=La ville se réveille");
  const code = (await host.page.locator("strong.font-display").first().innerText()).trim();
  log("room created", code);
  players.push(host);

  for (const name of NAMES.slice(1)) {
    const p = await open(name, name === "Elio" ? 390 : 1280); // Elio plays on a phone-sized screen
    await p.page.fill("#roomCode", code);
    await p.page.click("text=Rejoindre");
    await p.page.waitForSelector("text=La ville se réveille");
    players.push(p);
  }

  // invalid join: duplicate name
  const dup = await open("alba");
  await dup.page.fill("#roomCode", code);
  await dup.page.click("text=Rejoindre");
  await dup.page.waitForSelector("text=Ce nom est déjà pris");
  log("duplicate name refused ✓");
  await dup.page.context().close();

  // start is blocked until everyone is ready
  const start = host.page.locator("text=🚀 Lancer la partie");
  assert.equal(await start.isDisabled(), true);
  for (const p of players.slice(1)) await p.page.click("text=✓ Je suis prêt");

  // lobby chat
  await players[1].page.fill('input[aria-label="Message"]', "Salut la ville <b>!</b>");
  await players[1].page.press('input[aria-label="Message"]', "Enter");
  await host.page.waitForSelector("text=Salut la ville <b>!</b>");
  log("lobby chat delivered, HTML shown as text ✓");
  await shot(host.page, "1-lobby");

  await host.page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Lancer la partie"));
    return b && !b.disabled;
  });
  await start.click();

  // ---------------------------------------------------------- roles
  await host.page.waitForSelector("text=Ton rôle secret");
  await shot(host.page, "2-role-reveal");
  for (const p of players) p.role = (await roleText(p.page)).split("\n").find((l) => /Parrain|Mafieux|Détective|Médecin|Citoyen|Espion|Garde/.test(l));
  for (const p of players) p.role = p.role.trim();
  log("roles:", players.map((p) => `${p.name}=${p.role}`).join(", "));
  const boss = players.find((p) => p.role === "Parrain");
  const doctor = players.find((p) => p.role === "Médecin");
  const detective = players.find((p) => p.role === "Détective");
  const citizens = players.filter((p) => p.role === "Citoyen");
  assert.ok(boss && doctor && detective && citizens.length === 2, "5-player deck");

  // ---------------------------------------------------------- night 1
  await host.page.waitForSelector("text=Nuit · tour 1", { timeout: 15000 });

  // Mafia chat: only the boss can read it.
  await boss.page.fill('input[aria-label="Message"]', "secret mafia plan");
  await boss.page.press('input[aria-label="Message"]', "Enter");
  await boss.page.waitForSelector("text=secret mafia plan");
  for (const p of players.filter((x) => x !== boss)) {
    assert.equal(await p.page.locator("text=secret mafia plan").count(), 0, `${p.name} must not see Mafia chat`);
  }
  log("Mafia chat private ✓");

  // A citizen cannot write in the village at night.
  assert.equal(await citizens[0].page.locator('input[aria-label="Message"]').isDisabled(), true);

  const victim = citizens[0];
  await card(boss.page, victim.name).click();
  await boss.page.click("text=Confirmer");
  await card(doctor.page, citizens[1].name).click();
  await doctor.page.click("text=Confirmer");
  await shot(detective.page, "3-night-detective");
  await card(detective.page, boss.name).click();
  await detective.page.click("text=Confirmer");

  // Detective gets a private result (the Parrain looks innocent).
  await detective.page.waitForSelector("text=Résultat de l'enquête");
  assert.match(await detective.page.locator('[role="dialog"]').innerText(), /innocent/);
  await detective.page.click("text=Compris");
  log("detective result private modal ✓");

  // ---------------------------------------------------------- day 1
  await host.page.waitForSelector(`text=/${victim.name}.*a été assassiné/`, { timeout: 15000 });
  log(`${victim.name} died in the night ✓`);
  await shot(host.page, "4-dawn");

  // Reconnection: the detective refreshes the page and gets the seat back.
  await detective.page.reload();
  await detective.page.waitForSelector('section[aria-label="Mon rôle"]');
  assert.match(await roleText(detective.page), /Détective/);
  log("refresh -> same seat and role ✓");

  await host.page.waitForSelector("text=Débat ouvert", { timeout: 15000 });
  await detective.page.fill('input[aria-label="Message"]', `${boss.name} est suspect.`);
  await detective.page.press('input[aria-label="Message"]', "Enter");
  await host.page.waitForSelector(`text=${boss.name} est suspect.`);

  // The dead victim cannot talk in the village.
  assert.equal(await victim.page.locator('input[aria-label="Message"]').isDisabled(), true);
  log("dead player muted in village ✓");
  await shot(players[4].page, "5-discussion-mobile");

  await host.page.click("text=⏭️ Passer au vote"); // the host keeps this power even when dead

  // ---------------------------------------------------------- vote
  const living = players.filter((p) => p !== victim);
  await living[0].page.waitForSelector("text=Qui doit quitter la ville ?");
  for (const voter of living.filter((p) => p !== boss)) {
    await card(voter.page, boss.name).click();
    await voter.page.click("text=Confirmer le vote");
  }
  await shot(host.page, "6-vote");
  const bossTarget = living.find((p) => p !== boss);
  await card(boss.page, bossTarget.name).click();
  await boss.page.click("text=Confirmer le vote");

  // ---------------------------------------------------------- end
  await host.page.waitForSelector("text=La ville a gagné", { timeout: 15000 });
  log("city wins after voting out the Parrain ✓");
  await shot(host.page, "7-end");

  await host.page.click("text=Nouvelle partie");
  await host.page.waitForSelector("text=La ville se réveille");
  log("restart -> back to lobby ✓");

  console.log("\nE2E PASSED");
} catch (error) {
  console.error("\nE2E FAILED:", error.message);
  for (const p of players) await shot(p.page, `fail-${p.name}`).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
