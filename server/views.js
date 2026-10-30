// Builds what each player is allowed to see. The room object is never sent
// as-is: every field below is chosen on purpose so no secret can leak.
import { CHANNELS, PHASES } from "../shared/constants.js";
import { FIXED_PHASE_SECONDS, MAX_PLAYERS, MIN_PLAYERS } from "./config.js";
import { abilityOf, canVote, countVotes, validateNightAction } from "./engine.js";
import { isMafia, roleInfo } from "./roles.js";
import { writeBlocker } from "./chat.js";

/** Is `viewer` allowed to know the role of `player`? */
function canSeeRole(room, viewer, player) {
  if (!player.role) return false;
  if (room.phase === PHASES.ENDED) return true;
  if (viewer.id === player.id) return true;
  if (!player.alive && room.settings.revealRolesOnDeath) return true;
  return viewer.alive && isMafia(viewer) && isMafia(player);
}

function publicPlayer(room, viewer, player) {
  return {
    id: player.id,
    name: player.name,
    avatar: player.avatar,
    connected: player.connected,
    ready: player.ready,
    isHost: player.id === room.hostId,
    alive: player.alive,
    silenced: player.silenced,
    death: player.death,
    role: canSeeRole(room, viewer, player) ? roleInfo(player.role) : null,
  };
}

/** Night information for the viewer: their own choice and what they may target. */
function nightView(room, me) {
  const ability = abilityOf(me);
  if (room.phase !== PHASES.NIGHT || !me.alive || !ability) return null;

  const targetIds = room.players
    .filter((p) => !validateNightAction(room, me, { targetId: p.id }))
    .map((p) => p.id);

  const view = {
    ability,
    targetIds,
    myAction: room.nightActions[me.id] || null,
    kidnapIds: null,
    teamPicks: null,
  };

  if (me.role === "boss") {
    view.kidnapIds = room.players.filter((p) => p.alive && !isMafia(p)).map((p) => p.id);
  }
  if (isMafia(me)) {
    // Mafia members see each other's picks to coordinate.
    view.teamPicks = Object.fromEntries(
      room.players
        .filter((p) => p.alive && isMafia(p) && room.nightActions[p.id])
        .map((p) => [p.id, room.nightActions[p.id].targetId])
    );
  }
  return view;
}

function chatRights(room, me) {
  return Object.fromEntries(
    [CHANNELS.LOBBY, CHANNELS.VILLAGE, CHANNELS.MAFIA, CHANNELS.DEAD].map((channel) => [
      channel,
      { canWrite: !writeBlocker(room, me, channel), reason: writeBlocker(room, me, channel) },
    ])
  );
}

/** The full state sent to one player in the `room:state` event. */
export function roomView(room, me) {
  const showVotes = room.phase === PHASES.VOTE;
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    hostId: room.hostId,
    settings: room.settings,
    fixedPhaseSeconds: FIXED_PHASE_SECONDS,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    phaseEndsAt: room.phaseEndsAt,
    serverNow: Date.now(),
    players: room.players.map((p) => publicPlayer(room, me, p)),
    votes: showVotes ? { ...room.votes } : null,
    voteCounts: showVotes ? countVotes(room) : null,
    lastNight: room.lastNight,
    lastVerdict: room.lastVerdict,
    winner: room.winner,
    journal: room.journal.slice(-40),
    me: {
      id: me.id,
      sessionId: me.sessionId,
      isHost: me.id === room.hostId,
      role: me.role ? roleInfo(me.role) : null,
      alive: me.alive,
      silenced: me.silenced,
      canVote: room.phase === PHASES.VOTE && canVote(me),
      myVote: room.votes[me.id] || null,
      night: nightView(room, me),
      results: me.results,
      chat: chatRights(room, me),
    },
  };
}
