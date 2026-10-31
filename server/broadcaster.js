// The only module that sends data to sockets. Every message goes to each
// player individually, so private data (roles, Mafia chat) never reaches the wrong person.
import { EVENTS } from "../shared/constants.js";
import { addSystemMessage, canRead, historyFor } from "./chat.js";
import { findPlayer } from "./engine.js";
import { roomView } from "./views.js";

export function createBroadcaster(io) {
  function emitTo(player, event, payload) {
    if (player.socketId) io.to(player.socketId).emit(event, payload);
  }

  return {
    /** Personal room:state for every player in the room. */
    state(room) {
      room.players.forEach((p) => emitTo(p, EVENTS.ROOM_STATE, roomView(room, p)));
    },

    /** Sends one chat message only to the players allowed to read its channel. */
    chat(room, message) {
      room.players
        .filter((p) => canRead(room, p, message.channel))
        .forEach((p) => emitTo(p, EVENTS.CHAT_MESSAGE, message));
    },

    announce(room, text) {
      this.chat(room, addSystemMessage(room, text));
    },

    privateResult(room, result) {
      const player = findPlayer(room, result.playerId);
      if (player) emitTo(player, EVENTS.NIGHT_RESULT, result);
    },

    /** Resends the whole readable history (after joining, dying, or a new game). */
    syncHistory(room, onlyPlayer = null) {
      const targets = onlyPlayer ? [onlyPlayer] : room.players;
      targets.forEach((p) => emitTo(p, EVENTS.CHAT_HISTORY, historyFor(room, p)));
    },

    notice(player, text, level = "info") {
      emitTo(player, EVENTS.NOTICE, { text, level });
    },
  };
}
