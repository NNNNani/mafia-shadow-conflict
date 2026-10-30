// Pure game rules. No sockets, no timers: every function reads or changes a
// `room` object and returns plain data. This makes the rules easy to unit-test.
import { PHASES, TEAMS } from "../shared/constants.js";
import { ROLES, isMafia, roleInfo } from "./roles.js";

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
  player.silenced = false;
  player.death = { round: room.round, cause };
}

// ---------------------------------------------------------------- setup

/** Gives each player a role from an already shuffled deck and resets their game data. */
export function assignRoles(room, shuffledDeck) {
  room.players.forEach((player, index) => {
    player.role = shuffledDeck[index];
    player.alive = true;
    player.silenced = false;
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

/** Called when a new night begins: kidnapping only lasts one day. */
export function prepareNight(room) {
  room.round += 1;
  room.nightActions = {};
  room.votes = {};
  room.players.forEach((p) => (p.silenced = false));
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
 * action = { targetId, kidnapId? }
 */
export function validateNightAction(room, actor, action) {
  if (room.phase !== PHASES.NIGHT) return "Ce n'est pas la nuit.";
  if (!actor.alive) return "Les morts ne peuvent pas agir.";

  const ability = abilityOf(actor);
  if (!ability) return "Ton rôle n'a pas d'action de nuit.";

  const target = findPlayer(room, action?.targetId);
  if (!target || !target.alive) return "Choisis un joueur vivant.";

  if (ability === "kill" && isMafia(target)) {
    return "La Mafia ne peut pas viser un des siens.";
  }
  if (ability === "heal" && target.id === room.lastHealTargetId) {
    return "Tu ne peux pas soigner la même personne deux nuits de suite.";
  }
  if (["protect", "investigate", "spy"].includes(ability) && target.id === actor.id) {
    return "Tu ne peux pas te choisir toi-même.";
  }

  if (action.kidnapId) {
    if (actor.role !== "boss") return "Seul le Parrain peut kidnapper.";
    const kidnapped = findPlayer(room, action.kidnapId);
    if (!kidnapped || !kidnapped.alive || isMafia(kidnapped)) {
      return "Tu ne peux pas kidnapper ce joueur.";
    }
  }
  return null;
}

export function recordNightAction(room, actor, action) {
  room.nightActions[actor.id] = {
    targetId: action.targetId,
    kidnapId: actor.role === "boss" ? action.kidnapId || null : null,
    at: Date.now(),
  };
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
 * The Mafia victim: the Parrain's choice if he is alive and chose,
 * otherwise the target most chosen by the other Mafia members.
 */
export function chooseMafiaTarget(room) {
  const boss = aliveWithRole(room, "boss");
  if (boss && room.nightActions[boss.id]) return room.nightActions[boss.id].targetId;

  const tally = new Map();
  room.players
    .filter((p) => p.alive && isMafia(p) && room.nightActions[p.id])
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
 * Order: Mafia attack -> Médecin heal -> Garde du corps -> deaths -> kidnapping -> investigations.
 */
export function resolveNight(room) {
  const heal = actionOfRole(room, "doctor");
  const guard = actionOfRole(room, "bodyguard");
  const investigation = actionOfRole(room, "detective");
  const spying = actionOfRole(room, "spy");
  const boss = actionOfRole(room, "boss");

  const report = { round: room.round, deaths: [], attackBlocked: false, kidnappedId: null };
  const privateResults = [];

  const targetId = chooseMafiaTarget(room);
  if (targetId) {
    if (heal?.targetId === targetId) {
      report.attackBlocked = true;
    } else if (guard && guard.targetId === targetId) {
      // The bodyguard takes the bullet for the person he protects.
      report.attackBlocked = true;
      report.deaths.push({ playerId: guard.actor.id, cause: "bodyguard" });
    } else {
      report.deaths.push({ playerId: targetId, cause: "mafia" });
    }
  }

  const dyingIds = new Set(report.deaths.map((d) => d.playerId));

  if (investigation && !dyingIds.has(investigation.actor.id)) {
    const target = findPlayer(room, investigation.targetId);
    const looksMafia = target.role === "mafia"; // the Parrain looks innocent
    privateResults.push({
      playerId: investigation.actor.id,
      title: "Résultat de l'enquête",
      text: `${target.name} est ${looksMafia ? "membre de la Mafia" : "innocent"}.`,
      round: room.round,
    });
  }

  if (spying && !dyingIds.has(spying.actor.id)) {
    const target = findPlayer(room, spying.targetId);
    privateResults.push({
      playerId: spying.actor.id,
      title: "Rapport d'espionnage",
      text: `${target.name} ${target.role === "boss" ? "EST le Parrain" : "n'est pas le Parrain"}.`,
      round: room.round,
    });
  }

  report.deaths.forEach(({ playerId, cause }) => kill(room, findPlayer(room, playerId), cause));

  const kidnapped = boss?.kidnapId && findPlayer(room, boss.kidnapId);
  if (kidnapped?.alive) {
    kidnapped.silenced = true;
    report.kidnappedId = kidnapped.id;
  }

  privateResults.forEach((r) => findPlayer(room, r.playerId).results.push(r));

  room.lastHealTargetId = heal ? heal.targetId : null;
  room.nightActions = {};
  room.lastNight = report;
  return { report, privateResults };
}

// ---------------------------------------------------------------- day vote

export function canVote(player) {
  return player.alive && !player.silenced;
}

/** targetId === null withdraws the vote. Returns an error message or null. */
export function validateVote(room, voter, targetId) {
  if (room.phase !== PHASES.VOTE) return "Le vote n'est pas ouvert.";
  if (!voter.alive) return "Les morts ne votent pas.";
  if (voter.silenced) return "Tu as été kidnappé : tu ne peux pas voter aujourd'hui.";
  if (targetId === null) return null;

  const target = findPlayer(room, targetId);
  if (!target || !target.alive) return "Vote pour un joueur vivant.";
  if (target.id === voter.id) return "Tu ne peux pas voter contre toi-même.";
  return null;
}

export function recordVote(room, voter, targetId) {
  if (targetId === null) delete room.votes[voter.id];
  else room.votes[voter.id] = targetId;
}

/** True when every connected player allowed to vote has voted. */
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

/** Returns TEAMS.CITY, TEAMS.MAFIA or null if the game goes on. */
export function checkWinner(room) {
  const alive = alivePlayers(room);
  const mafia = alive.filter(isMafia).length;
  const others = alive.length - mafia;

  if (mafia === 0) return TEAMS.CITY;
  if (mafia >= others) return TEAMS.MAFIA;
  return null;
}

/** Text describing a dead player, with the role if the room reveals roles. */
export function describeDeath(room, player) {
  const role = roleInfo(player.role);
  return room.settings.revealRolesOnDeath ? `${player.name} (${role.emoji} ${role.name})` : player.name;
}
