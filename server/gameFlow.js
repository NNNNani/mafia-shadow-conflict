// Game flow: phase order, timers and announcements.
// It applies the rules from engine.js and tells the broadcaster what to send.
import { GAME_PHASES, PHASES, TEAMS } from "../shared/constants.js";
import { FIXED_PHASE_SECONDS, MAX_PLAYERS, MIN_PLAYERS, TIME_SCALE } from "./config.js";
import * as engine from "./engine.js";
import { buildRoleDeck, shuffle } from "./roles.js";
import { clearGameChannels } from "./chat.js";
import { GameError } from "./rooms.js";

const DEATH_TEXT = {
  mafia: "a été assassiné cette nuit",
  bodyguard: "est mort en protégeant quelqu'un",
  vote: "a été éliminé par le village",
  left: "a quitté la ville",
};

/**
 * @param {object} out  the broadcaster:
 *   out.state(room)                       send room:state to every player
 *   out.announce(room, text)              system chat message to everyone
 *   out.privateResult(room, result)       night result to one player
 *   out.syncHistory(room)                 resend chat history (channel access changed)
 */
export function createGameFlow(out) {
  // ------------------------------------------------------------ timers

  /** Switches phase, starts its timer and broadcasts the new state. */
  function enterPhase(room, phase, seconds, onExpire) {
    clearTimeout(room.timer);
    room.timer = null;
    room.phase = phase;
    room.phaseToken += 1;

    if (seconds) {
      const token = room.phaseToken;
      const ms = Math.round(seconds * 1000 * TIME_SCALE);
      room.phaseEndsAt = Date.now() + ms;
      room.timer = setTimeout(() => {
        // Ignore a timer from a phase that already ended early.
        if (room.phaseToken === token) onExpire();
      }, ms);
    } else {
      room.phaseEndsAt = null;
    }
    out.state(room);
  }

  function log(room, text) {
    room.journal.push({ round: room.round, text, ts: Date.now() });
    out.announce(room, text);
  }

  // ------------------------------------------------------------ start

  function startGame(room, requester) {
    if (requester.id !== room.hostId) throw new GameError("Seul l'hôte peut lancer la partie.");
    if (room.phase !== PHASES.LOBBY) throw new GameError("La partie a déjà commencé.");

    const count = room.players.length;
    if (count < MIN_PLAYERS) throw new GameError(`Il faut au moins ${MIN_PLAYERS} joueurs.`);
    if (count > MAX_PLAYERS) throw new GameError(`${MAX_PLAYERS} joueurs maximum.`);

    const offline = room.players.find((p) => !p.connected);
    if (offline) throw new GameError(`${offline.name} est déconnecté.`);

    const notReady = room.players.find((p) => !p.ready);
    if (notReady) throw new GameError(`${notReady.name} n'est pas prêt.`);

    engine.assignRoles(room, shuffle(buildRoleDeck(count)));
    room.journal = [];
    clearGameChannels(room);
    out.syncHistory(room);

    log(room, "🎭 Les rôles ont été distribués en secret.");
    enterPhase(room, PHASES.ROLE_REVEAL, FIXED_PHASE_SECONDS.roleReveal, () => beginNight(room));
  }

  // ------------------------------------------------------------ night

  function beginNight(room) {
    engine.prepareNight(room);
    log(room, `🌙 La nuit n°${room.round} tombe sur la ville.`);
    enterPhase(room, PHASES.NIGHT, room.settings.nightSeconds, () => finishNight(room));
    if (engine.isNightComplete(room)) finishNight(room);
  }

  function submitNightAction(room, player, action) {
    const error = engine.validateNightAction(room, player, action);
    if (error) throw new GameError(error);

    engine.recordNightAction(room, player, action);
    if (engine.isNightComplete(room)) finishNight(room);
    else out.state(room);
  }

  function finishNight(room) {
    if (room.phase !== PHASES.NIGHT) return;
    const { report, privateResults } = engine.resolveNight(room);

    privateResults.forEach((result) => out.privateResult(room, result));

    log(room, "☀️ Le jour se lève.");
    if (report.deaths.length === 0) {
      log(room, report.attackBlocked
        ? "🛡️ Une attaque a été déjouée cette nuit. Personne n'est mort."
        : "😮‍💨 La nuit a été calme. Personne n'est mort.");
    }
    report.deaths.forEach(({ playerId, cause }) => {
      const victim = engine.findPlayer(room, playerId);
      log(room, `☠️ ${engine.describeDeath(room, victim)} ${DEATH_TEXT[cause]}.`);
    });
    if (report.kidnappedId) {
      const kidnapped = engine.findPlayer(room, report.kidnappedId);
      log(room, `🤐 ${kidnapped.name} a été kidnappé : silence et pas de vote aujourd'hui.`);
    }
    if (report.deaths.length) out.syncHistory(room);

    if (endIfWinner(room)) return;
    enterPhase(room, PHASES.DAWN, FIXED_PHASE_SECONDS.dawn, () => beginDiscussion(room));
  }

  // ------------------------------------------------------------ day

  function beginDiscussion(room) {
    log(room, "💬 Débat ouvert : qui ment dans cette ville ?");
    enterPhase(room, PHASES.DISCUSSION, room.settings.discussionSeconds, () => beginVote(room));
  }

  function skipDiscussion(room, player) {
    if (player.id !== room.hostId) throw new GameError("Seul l'hôte peut passer au vote.");
    if (room.phase !== PHASES.DISCUSSION) throw new GameError("Pas de débat en cours.");
    beginVote(room);
  }

  function beginVote(room) {
    room.votes = {};
    log(room, "🗳️ Le vote est ouvert. Choisissez qui éliminer.");
    enterPhase(room, PHASES.VOTE, room.settings.voteSeconds, () => finishVote(room));
    if (engine.isVoteComplete(room)) finishVote(room);
  }

  function castVote(room, player, targetId) {
    const error = engine.validateVote(room, player, targetId);
    if (error) throw new GameError(error);

    engine.recordVote(room, player, targetId);
    if (engine.isVoteComplete(room)) finishVote(room);
    else out.state(room);
  }

  function finishVote(room) {
    if (room.phase !== PHASES.VOTE) return;
    const verdict = engine.resolveVotes(room);

    if (verdict.eliminatedId) {
      const target = engine.findPlayer(room, verdict.eliminatedId);
      log(room, `⚖️ ${engine.describeDeath(room, target)} ${DEATH_TEXT.vote}.`);
      out.syncHistory(room);
    } else if (verdict.tie) {
      log(room, "⚖️ Égalité : personne n'est éliminé aujourd'hui.");
    } else {
      log(room, "⚖️ Aucun vote : personne n'est éliminé aujourd'hui.");
    }

    if (endIfWinner(room)) return;
    enterPhase(room, PHASES.VERDICT, FIXED_PHASE_SECONDS.verdict, () => beginNight(room));
  }

  // ------------------------------------------------------------ end

  function endIfWinner(room) {
    const winner = engine.checkWinner(room);
    if (!winner) return false;

    room.winner = winner;
    log(room, winner === TEAMS.CITY
      ? "🏆 La ville a gagné : la Mafia est démantelée !"
      : "🏆 La Mafia a pris le contrôle de la ville !");
    enterPhase(room, PHASES.ENDED, null);
    out.syncHistory(room);
    return true;
  }

  /** A player left for good during a game: they count as dead. */
  function playerLeft(room, player) {
    if (!GAME_PHASES.includes(room.phase)) return;
    engine.forfeit(room, player);
    log(room, `🚪 ${engine.describeDeath(room, player)} ${DEATH_TEXT.left}.`);
    if (endIfWinner(room)) return;
    afterPresenceChange(room);
  }

  /** Someone connected or disconnected: maybe nobody else is left to wait for. */
  function afterPresenceChange(room) {
    if (room.phase === PHASES.NIGHT && engine.isNightComplete(room)) finishNight(room);
    else if (room.phase === PHASES.VOTE && engine.isVoteComplete(room)) finishVote(room);
    else out.state(room);
  }

  /** Back to the lobby with the same players, after a game ended. */
  function restart(room, player) {
    if (player.id !== room.hostId) throw new GameError("Seul l'hôte peut relancer.");
    if (room.phase !== PHASES.ENDED) throw new GameError("La partie n'est pas terminée.");

    room.players.forEach((p) => {
      p.role = null;
      p.alive = true;
      p.silenced = false;
      p.death = null;
      p.results = [];
      p.ready = p.id === room.hostId;
    });
    Object.assign(room, {
      round: 0, winner: null, lastNight: null, lastVerdict: null,
      votes: {}, nightActions: {}, lastHealTargetId: null, journal: [],
    });
    clearGameChannels(room);
    out.syncHistory(room);
    enterPhase(room, PHASES.LOBBY, null);
  }

  return {
    startGame,
    submitNightAction,
    skipDiscussion,
    castVote,
    playerLeft,
    afterPresenceChange,
    restart,
  };
}
