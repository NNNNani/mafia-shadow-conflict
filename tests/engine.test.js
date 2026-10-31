// Unit tests for the pure game rules (Loup-Garou). Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { PHASES, TEAMS } from "../shared/constants.js";
import { DEFAULT_SETTINGS } from "../server/config.js";
import * as engine from "../server/engine.js";
import { buildRoleDeck } from "../server/roles.js";
import { addPlayerMessage, canRead, writeBlocker } from "../server/chat.js";
import { roomView } from "../server/views.js";

const NAMES = ["Amine", "Badr", "Chama", "Driss", "Enzo", "Fatima", "Ghita", "Hamza"];
const DECK = ["werewolf", "werewolf", "detective", "doctor", "villager", "villager", "villager", "villager"];

/** An 8-player room: Amine and Badr are werewolves, Chama detective, Driss doctor,
 *  the rest villagers. Phase: night 1. */
function makeRoom() {
  const room = {
    code: "TEST01", phase: PHASES.LOBBY, settings: { ...DEFAULT_SETTINGS }, journal: [],
    chat: { lobby: [], village: [], wolves: [], dead: [], system: [] },
    players: NAMES.map((name, i) => ({
      id: name.toLowerCase(), sessionId: `s-${i}`, name, avatar: i, connected: true,
      ready: true, chatTimes: [],
    })),
  };
  engine.assignRoles(room, DECK);
  engine.prepareNight(room);
  room.phase = PHASES.NIGHT;
  return room;
}
const act = (room, actorId, targetId) => {
  const actor = engine.findPlayer(room, actorId);
  const error = engine.validateNightAction(room, actor, { targetId });
  assert.equal(error, null, `action of ${actorId} refused: ${error}`);
  engine.recordNightAction(room, actor, { targetId });
};
const isAlive = (room, id) => engine.findPlayer(room, id).alive;

test("role deck: 1 werewolf per 4 players, one detective, one doctor", () => {
  assert.deepEqual(buildRoleDeck(5).sort(), ["detective", "doctor", "villager", "villager", "werewolf"]);
  for (const count of [8, 10, 20, 30]) {
    const deck = buildRoleDeck(count);
    assert.equal(deck.length, count);
    assert.equal(deck.filter((r) => r === "werewolf").length, Math.floor(count / 4));
    assert.equal(deck.filter((r) => r === "detective").length, 1);
    assert.equal(deck.filter((r) => r === "doctor").length, 1);
  }
});

test("werewolves kill the victim they agree on", () => {
  const room = makeRoom();
  act(room, "amine", "ghita");
  act(room, "badr", "ghita");
  const { report } = engine.resolveNight(room);
  assert.equal(isAlive(room, "ghita"), false);
  assert.deepEqual(report.deaths, [{ playerId: "ghita", cause: "wolves" }]);
});

test("split werewolf vote: the first chosen target wins the tie", () => {
  const room = makeRoom();
  act(room, "amine", "ghita");
  room.nightActions.amine.at = 1;
  act(room, "badr", "hamza");
  room.nightActions.badr.at = 2;
  engine.resolveNight(room);
  assert.equal(isAlive(room, "ghita"), false);
  assert.equal(isAlive(room, "hamza"), true);
});

test("doctor protection saves the victim", () => {
  const room = makeRoom();
  act(room, "amine", "ghita");
  act(room, "driss", "ghita");
  const { report } = engine.resolveNight(room);
  assert.equal(report.deaths.length, 0);
  assert.equal(report.attackBlocked, true);
});

test("doctor can protect himself, but not the same player two nights in a row", () => {
  const room = makeRoom();
  act(room, "driss", "driss");
  engine.resolveNight(room);
  engine.prepareNight(room);
  const error = engine.validateNightAction(room, engine.findPlayer(room, "driss"), { targetId: "driss" });
  assert.match(error, /ليلتين/);
});

test("detective learns privately who is a werewolf", () => {
  const room = makeRoom();
  act(room, "chama", "badr");
  let { privateResults } = engine.resolveNight(room);
  assert.equal(privateResults.length, 1);
  assert.equal(privateResults[0].playerId, "chama");
  assert.match(privateResults[0].text, /مستذئب!/);

  engine.prepareNight(room);
  act(room, "chama", "hamza");
  ({ privateResults } = engine.resolveNight(room));
  assert.match(privateResults[0].text, /بريء/);
});

test("invalid night actions are refused", () => {
  const room = makeRoom();
  const get = (id) => engine.findPlayer(room, id);
  assert.ok(engine.validateNightAction(room, get("amine"), { targetId: "badr" }), "wolf on wolf");
  assert.ok(engine.validateNightAction(room, get("chama"), { targetId: "chama" }), "detective on self");
  assert.ok(engine.validateNightAction(room, get("ghita"), { targetId: "hamza" }), "villager acting");
  assert.ok(engine.validateNightAction(room, get("amine"), { targetId: "nobody" }), "unknown target");
  room.phase = PHASES.VOTE;
  assert.ok(engine.validateNightAction(room, get("amine"), { targetId: "hamza" }), "outside night");
});

test("night completes without waiting for disconnected actors", () => {
  const room = makeRoom();
  act(room, "amine", "ghita");
  act(room, "badr", "ghita");
  act(room, "chama", "hamza");
  assert.equal(engine.isNightComplete(room), false);
  engine.findPlayer(room, "driss").connected = false;
  assert.equal(engine.isNightComplete(room), true);
});

test("vote: plurality eliminates, tie eliminates nobody, dead cannot vote", () => {
  const room = makeRoom();
  room.phase = PHASES.VOTE;
  const vote = (voter, target) => engine.recordVote(room, engine.findPlayer(room, voter), target);
  vote("chama", "amine"); vote("driss", "amine"); vote("amine", "chama");
  assert.equal(engine.resolveVotes(room).eliminatedId, "amine");

  room.phase = PHASES.VOTE;
  assert.ok(engine.validateVote(room, engine.findPlayer(room, "amine"), "badr"), "dead voter");
  vote("chama", "badr"); vote("badr", "chama");
  const verdict = engine.resolveVotes(room);
  assert.equal(verdict.tie, true);
  assert.equal(verdict.eliminatedId, null);
});

test("winner: villagers when no werewolf is left, werewolves at parity", () => {
  const room = makeRoom();
  assert.equal(engine.checkWinner(room), null);
  ["amine", "badr"].forEach((id) => (engine.findPlayer(room, id).alive = false));
  assert.equal(engine.checkWinner(room), TEAMS.VILLAGE);

  const room2 = makeRoom();
  ["chama", "driss", "enzo", "fatima"].forEach((id) => (engine.findPlayer(room2, id).alive = false));
  assert.equal(engine.checkWinner(room2), TEAMS.WOLVES); // 2 wolves vs 2 villagers
});

test("chat: only living werewolves read the wolves channel; it is closed by day", () => {
  const room = makeRoom();
  const get = (id) => engine.findPlayer(room, id);
  assert.equal(canRead(room, get("badr"), "wolves"), true);
  assert.equal(canRead(room, get("chama"), "wolves"), false);
  assert.throws(() => addPlayerMessage(room, get("chama"), "wolves", "hello"));
  addPlayerMessage(room, get("badr"), "wolves", "نهاجم غيثة");
  room.phase = PHASES.DISCUSSION;
  assert.throws(() => addPlayerMessage(room, get("badr"), "wolves", "hello"));
  get("badr").alive = false;
  assert.equal(canRead(room, get("badr"), "wolves"), false);
  assert.ok(writeBlocker(room, get("badr"), "village"), "dead cannot talk in the village");
});

test("chat: rate limit and empty messages", () => {
  const room = makeRoom();
  room.phase = PHASES.DISCUSSION;
  const ghita = engine.findPlayer(room, "ghita");
  assert.throws(() => addPlayerMessage(room, ghita, "village", "   "));
  for (let i = 0; i < 5; i++) addPlayerMessage(room, ghita, "village", `msg ${i}`);
  assert.throws(() => addPlayerMessage(room, ghita, "village", "spam"), /مهلك/);
});

test("views: a villager never sees other roles, sessions or night actions", () => {
  const room = makeRoom();
  act(room, "amine", "ghita");
  const view = roomView(room, engine.findPlayer(room, "ghita"));
  const others = view.players.filter((p) => p.id !== "ghita");
  assert.ok(others.every((p) => p.role === null));
  assert.ok(!JSON.stringify(view).includes("s-0"), "another player's sessionId leaked");
  assert.equal(view.me.night, null);

  const wolfView = roomView(room, engine.findPlayer(room, "badr"));
  assert.equal(wolfView.players.find((p) => p.id === "amine").role.id, "werewolf");
  assert.equal(wolfView.me.night.teamPicks.amine, "ghita");
});
