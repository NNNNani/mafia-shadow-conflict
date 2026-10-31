// Pure game rules. No sockets, no timers: every function reads or changes a
// `room` object and returns plain data. This makes the rules easy to unit-test.
import { PHASES, TEAMS } from "../shared/constants.js";
import { ROLES, isWolf, roleInfo } from "./roles.js";

// ---------------------------------------------------------------- helpers

export function findPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId) || null;
}

export function alivePlayers(room) {
  return room.players.filter((p) => p.alive);
}

function aliveWithRole(room, roleId) {
  return room.players.find((p) => p.alive && p.role === roleId) || null;
}

function kill(room, player, cause) {
  player.alive = false;
  player.death = { round: room.round, cause };
}

// ---------------------------------------------------------------- setup

/** Gives each player a role from an already shuffled deck and resets their game data. */
export function assignRoles(room, shuffledDeck) {
  room.players.forEach((player, index) => {
    player.role = shuffledDeck[index];
    player.alive = true;
    player.death = null;
    player.results = [];
  });
  room.round = 0;
  room.nightActions = {};
  room.votes = {};
  room.lastHealTargetId = null;
  room.lastNight = null;
  room.lastVerdict = null;
  room.winner = null;
}

/** Called when a new night begins. */
export function prepareNight(room) {
  room.round += 1;
  room.nightActions = {};
  room.votes = {};
}

// ---------------------------------------------------------------- night

export function abilityOf(player) {
  return ROLES[player.role]?.nightAction || null;
}

/** Living players who have something to do at night. */
export function nightActors(room) {
  return room.players.filter((p) => p.alive && abilityOf(p));
}

/**
 * Checks a night action. Returns an error message, or null when it is valid.
 * action = { targetId }
 */
export function validateNightAction(room, actor, action) {
  if (room.phase !== PHASES.NIGHT) return "ليس الوقت ليلاً.";
  if (!actor.alive) return "الموتى لا يستطيعون التصرف.";

  const ability = abilityOf(actor);
  if (!ability) return "دورك ليست له قدرة ليلية.";

  const target = findPlayer(room, action?.targetId);
  if (!target || !target.alive) return "اختر لاعباً حياً.";

  if (ability === "kill" && isWolf(target)) return "لا يمكن للذئاب مهاجمة ذئب مثلهم.";
  if (ability === "heal" && target.id === room.lastHealTargetId) {
    return "لا يمكنك حماية الشخص نفسه ليلتين متتاليتين.";
  }
  if (ability === "investigate" && target.id === actor.id) return "لا يمكنك التحقيق مع نفسك.";
  return null;
}

export function recordNightAction(room, actor, action) {
  room.nightActions[actor.id] = { targetId: action.targetId, at: Date.now() };
}

/**
 * True when every *connected* living actor has chosen.
 * Disconnected players are not waited for: the night timer covers them.
 */
export function isNightComplete(room) {
  return nightActors(room)
    .filter((p) => p.connected)
    .every((p) => room.nightActions[p.id]);
}

/**
 * The werewolves' victim: the player chosen by the most werewolves.
 * On a tie, the target that was chosen first wins.
 */
export function chooseWolfTarget(room) {
  const tally = new Map();
  room.players
    .filter((p) => p.alive && isWolf(p) && room.nightActions[p.id])
    .sort((a, b) => room.nightActions[a.id].at - room.nightActions[b.id].at)
    .forEach((p) => {
      const targetId = room.nightActions[p.id].targetId;
      tally.set(targetId, (tally.get(targetId) || 0) + 1);
    });

  let best = null;
  let bestCount = 0;
  for (const [targetId, count] of tally) {
    if (count > bestCount) {
      best = targetId;
      bestCount = count;
    }
  }
  return best;
}

/** The night action of the living player who has `roleId`, with the actor attached. */
function actionOfRole(room, roleId) {
  const actor = aliveWithRole(room, roleId);
  const action = actor && room.nightActions[actor.id];
  return action ? { actor, ...action } : null;
}

/**
 * Applies every night action and returns what happened.
 * Order: werewolf attack -> doctor protection -> death -> detective result.
 */
export function resolveNight(room) {
  const heal = actionOfRole(room, "doctor");
  const investigation = actionOfRole(room, "detective");

  const report = { round: room.round, deaths: [], attackBlocked: false };
  const privateResults = [];

  const targetId = chooseWolfTarget(room);
  if (targetId) {
    if (heal?.targetId === targetId) report.attackBlocked = true;
    else report.deaths.push({ playerId: targetId, cause: "wolves" });
  }

  const dyingIds = new Set(report.deaths.map((d) => d.playerId));
  if (investigation && !dyingIds.has(investigation.actor.id)) {
    const target = findPlayer(room, investigation.targetId);
    privateResults.push({
      playerId: investigation.actor.id,
      title: "نتيجة التحقيق",
      text: isWolf(target) ? `${target.name} مستذئب! 🐺` : `${target.name} بريء، ليس مستذئباً.`,
      round: room.round,
    });
  }

  report.deaths.forEach(({ playerId, cause }) => kill(room, findPlayer(room, playerId), cause));
  privateResults.forEach((r) => findPlayer(room, r.playerId).results.push(r));

  room.lastHealTargetId = heal ? heal.targetId : null;
  room.nightActions = {};
  room.lastNight = report;
  return { report, privateResults };
}

// ---------------------------------------------------------------- day vote

export function canVote(player) {
  return player.alive;
}

/** targetId === null withdraws the vote. Returns an error message or null. */
export function validateVote(room, voter, targetId) {
  if (room.phase !== PHASES.VOTE) return "التصويت غير مفتوح الآن.";
  if (!voter.alive) return "الموتى لا يصوّتون.";
  if (targetId === null) return null;

  const target = findPlayer(room, targetId);
  if (!target || !target.alive) return "صوّت على لاعب حي.";
  if (target.id === voter.id) return "لا يمكنك التصويت ضد نفسك.";
  return null;
}

export function recordVote(room, voter, targetId) {
  if (targetId === null) delete room.votes[voter.id];
  else room.votes[voter.id] = targetId;
}

/** True when every connected living player has voted. */
export function isVoteComplete(room) {
  return room.players
    .filter((p) => canVote(p) && p.connected)
    .every((p) => room.votes[p.id]);
}

export function countVotes(room) {
  const counts = {};
  for (const [voterId, targetId] of Object.entries(room.votes)) {
    const voter = findPlayer(room, voterId);
    if (voter && canVote(voter)) counts[targetId] = (counts[targetId] || 0) + 1;
  }
  return counts;
}

/**
 * Closes the vote. The player with strictly the most votes is eliminated.
 * A tie, or no vote at all, eliminates nobody.
 */
export function resolveVotes(room) {
  const counts = countVotes(room);
  const max = Math.max(0, ...Object.values(counts));
  const leaders = Object.keys(counts).filter((id) => counts[id] === max);

  const verdict = { round: room.round, counts, eliminatedId: null, tie: false, noVotes: max === 0 };

  if (max > 0 && leaders.length === 1) {
    const target = findPlayer(room, leaders[0]);
    kill(room, target, "vote");
    verdict.eliminatedId = target.id;
  } else if (max > 0) {
    verdict.tie = true;
  }

  room.votes = {};
  room.lastVerdict = verdict;
  return verdict;
}

// ---------------------------------------------------------------- end

/** A player who leaves a running game is counted as dead. */
export function forfeit(room, player) {
  if (player.alive) kill(room, player, "left");
  delete room.nightActions[player.id];
  delete room.votes[player.id];
}

/**
 * Returns TEAMS.VILLAGE when no werewolf is left, TEAMS.WOLVES when the
 * werewolves equal or outnumber the other living players, otherwise null.
 */
export function checkWinner(room) {
  const alive = alivePlayers(room);
  const wolves = alive.filter(isWolf).length;
  const others = alive.length - wolves;

  if (wolves === 0) return TEAMS.VILLAGE;
  if (wolves >= others) return TEAMS.WOLVES;
  return null;
}

/** Text describing a dead player, with the role if the room reveals roles. */
export function describeDeath(room, player) {
  const role = roleInfo(player.role);
  return room.settings.revealRolesOnDeath ? `${player.name} (${role.emoji} ${role.name})` : player.name;
}
