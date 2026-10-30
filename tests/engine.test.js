// Unit tests for the pure game rules. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { PHASES, TEAMS } from "../shared/constants.js";
import { DEFAULT_SETTINGS } from "../server/config.js";
import * as engine from "../server/engine.js";
import { buildRoleDeck } from "../server/roles.js";
import { addPlayerMessage, canRead, writeBlocker } from "../server/chat.js";
import { roomView } from "../server/views.js";

const NAMES = ["Alba", "Bruno", "Cyra", "Dario", "Elio", "Fiona", "Gino", "Hana", "Ivo", "Jade"];
const DECK = ["boss", "mafia", "detective", "doctor", "spy", "bodyguard", "citizen", "citizen", "citizen", "citizen"];

/** A 10-player room where Alba=boss, Bruno=mafia, Cyra=detective, Dario=doctor,
 *  Elio=spy, Fiona=bodyguard, the rest citizens. Phase: night 1. */
function makeRoom() {
  const room = {
    code: "TEST01", phase: PHASES.LOBBY, settings: { ...DEFAULT_SETTINGS }, journal: [],
    chat: { lobby: [], village: [], mafia: [], dead: [], system: [] },
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
const act = (room, actorId, targetId, kidnapId) => {
  const actor = engine.findPlayer(room, actorId);
  const error = engine.validateNightAction(room, actor, { targetId, kidnapId });
  assert.equal(error, null, `action of ${actorId} refused: ${error}`);
  engine.recordNightAction(room, actor, { targetId, kidnapId });
};
const isAlive = (room, id) => engine.findPlayer(room, id).alive;

test("role deck: 10 players matches the original starter", () => {
  assert.deepEqual([...buildRoleDeck(10)].sort(), [...DECK].sort());
  assert.equal(buildRoleDeck(5).filter((r) => r === "boss").length, 1);
  assert.equal(buildRoleDeck(12).filter((r) => r === "mafia").length, 2);
});

test("bodyguard protecting the victim dies alone; the victim survives (starter bug)", () => {
  const room = makeRoom();
  act(room, "alba", "gino");
  act(room, "fiona", "gino");
  const { report } = engine.resolveNight(room);
  assert.equal(isAlive(room, "gino"), true);
  assert.equal(isAlive(room, "fiona"), false);
  assert.deepEqual(report.deaths, [{ playerId: "fiona", cause: "bodyguard" }]);
});

test("doctor heal saves the victim and nobody dies", () => {
  const room = makeRoom();
  act(room, "alba", "gino");
  act(room, "dario", "gino");
  act(room, "fiona", "gino");
  const { report } = engine.resolveNight(room);
  assert.equal(report.deaths.length, 0);
  assert.equal(report.attackBlocked, true);
});

test("doctor cannot heal the same player two nights in a row, but can heal himself", () => {
  const room = makeRoom();
  act(room, "dario", "dario");
  engine.resolveNight(room);
  engine.prepareNight(room);
  const error = engine.validateNightAction(room, engine.findPlayer(room, "dario"), { targetId: "dario" });
  assert.match(error, /deux nuits/);
});

test("the Parrain's choice beats the Mafieux; the Parrain looks innocent to the detective", () => {
  const room = makeRoom();
  act(room, "bruno", "hana");
  act(room, "alba", "ivo");
  act(room, "cyra", "alba");
  act(room, "elio", "alba");
  const { privateResults } = engine.resolveNight(room);
  assert.equal(isAlive(room, "ivo"), false);
  assert.equal(isAlive(room, "hana"), true);
  assert.match(privateResults.find((r) => r.playerId === "cyra").text, /innocent/);
  assert.match(privateResults.find((r) => r.playerId === "elio").text, /EST le Parrain/);
});

test("invalid night actions are refused", () => {
  const room = makeRoom();
  const get = (id) => engine.findPlayer(room, id);
  assert.ok(engine.validateNightAction(room, get("alba"), { targetId: "bruno" }), "mafia on mafia");
  assert.ok(engine.validateNightAction(room, get("fiona"), { targetId: "fiona" }), "guard on self");
  assert.ok(engine.validateNightAction(room, get("gino"), { targetId: "hana" }), "citizen acting");
  assert.ok(engine.validateNightAction(room, get("alba"), { targetId: "hana", kidnapId: "bruno" }), "kidnap mafia");
  assert.ok(engine.validateNightAction(room, get("alba"), { targetId: "nobody" }), "unknown target");
  room.phase = PHASES.VOTE;
  assert.ok(engine.validateNightAction(room, get("alba"), { targetId: "hana" }), "outside night");
});

test("night completes without waiting for disconnected actors", () => {
  const room = makeRoom();
  ["alba", "bruno", "cyra", "dario", "elio"].forEach((id) => {
    const target = id === "alba" || id === "bruno" ? "gino" : "hana";
    act(room, id, target);
  });
  assert.equal(engine.isNightComplete(room), false);
  engine.findPlayer(room, "fiona").connected = false;
  assert.equal(engine.isNightComplete(room), true);
});

test("kidnapped player cannot vote or talk in the village", () => {
  const room = makeRoom();
  act(room, "alba", "gino", "hana");
  engine.resolveNight(room);
  room.phase = PHASES.VOTE;
  const hana = engine.findPlayer(room, "hana");
  assert.equal(hana.silenced, true);
  assert.ok(engine.validateVote(room, hana, "alba"));
  assert.ok(writeBlocker(room, hana, "village"));
});

test("vote: plurality eliminates, tie eliminates nobody", () => {
  const room = makeRoom();
  room.phase = PHASES.VOTE;
  const vote = (voter, target) => engine.recordVote(room, engine.findPlayer(room, voter), target);
  vote("cyra", "alba"); vote("dario", "alba"); vote("alba", "cyra");
  assert.equal(engine.resolveVotes(room).eliminatedId, "alba");

  room.phase = PHASES.VOTE;
  vote("cyra", "bruno"); vote("bruno", "cyra");
  const verdict = engine.resolveVotes(room);
  assert.equal(verdict.tie, true);
  assert.equal(verdict.eliminatedId, null);
});

test("winner: city when Mafia is gone, Mafia when it reaches parity", () => {
  const room = makeRoom();
  assert.equal(engine.checkWinner(room), null);
  ["alba", "bruno"].forEach((id) => (engine.findPlayer(room, id).alive = false));
  assert.equal(engine.checkWinner(room), TEAMS.CITY);

  const room2 = makeRoom();
  ["cyra", "dario", "elio", "fiona", "gino", "hana"].forEach((id) => (engine.findPlayer(room2, id).alive = false));
  assert.equal(engine.checkWinner(room2), TEAMS.MAFIA);
});

test("chat: only living Mafia read the Mafia channel; it is closed by day", () => {
  const room = makeRoom();
  const get = (id) => engine.findPlayer(room, id);
  assert.equal(canRead(room, get("bruno"), "mafia"), true);
  assert.equal(canRead(room, get("cyra"), "mafia"), false);
  assert.throws(() => addPlayerMessage(room, get("cyra"), "mafia", "hello"));
  addPlayerMessage(room, get("bruno"), "mafia", "on vise Gino");
  room.phase = PHASES.DISCUSSION;
  assert.throws(() => addPlayerMessage(room, get("bruno"), "mafia", "hello"));
  get("bruno").alive = false;
  assert.equal(canRead(room, get("bruno"), "mafia"), false);
});

test("chat: rate limit and empty messages", () => {
  const room = makeRoom();
  room.phase = PHASES.DISCUSSION;
  const gino = engine.findPlayer(room, "gino");
  assert.throws(() => addPlayerMessage(room, gino, "village", "   "));
  for (let i = 0; i < 5; i++) addPlayerMessage(room, gino, "village", `msg ${i}`);
  assert.throws(() => addPlayerMessage(room, gino, "village", "spam"), /Doucement/);
});

test("views: a citizen never sees other roles, sessions or night actions", () => {
  const room = makeRoom();
  act(room, "alba", "gino");
  const view = roomView(room, engine.findPlayer(room, "gino"));
  const others = view.players.filter((p) => p.id !== "gino");
  assert.ok(others.every((p) => p.role === null));
  const json = JSON.stringify(view);
  assert.ok(!json.includes("s-0"), "another player's sessionId leaked");
  assert.equal(view.me.night, null);

  const mafiaView = roomView(room, engine.findPlayer(room, "bruno"));
  assert.equal(mafiaView.players.find((p) => p.id === "alba").role.id, "boss");
  assert.equal(mafiaView.me.night.teamPicks.alba, "gino");
});
