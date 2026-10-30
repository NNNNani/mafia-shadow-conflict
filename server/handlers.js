// Socket event handlers: check who is asking and what they send, then call
// the room store, the chat or the game flow. One function per client event.
import { EVENTS, PHASES, CHANNELS } from "../shared/constants.js";
import { EMPTY_ROOM_TTL_MS, LOBBY_GRACE_MS, SETTINGS_BOUNDS } from "./config.js";
import { addPlayerMessage } from "./chat.js";
import { GameError } from "./rooms.js";

/**
 * Wraps a handler so it always answers the acknowledgement callback with
 * { ok: true, data } or { ok: false, error }, and never crashes the server.
 */
function safe(handler) {
  return async (payload, ack) => {
    if (typeof payload === "function") [payload, ack] = [{}, payload];
    const reply = typeof ack === "function" ? ack : () => {};
    try {
      const body = payload && typeof payload === "object" ? payload : {};
      reply({ ok: true, data: (await handler(body)) ?? null });
    } catch (error) {
      if (!(error instanceof GameError)) console.error("[handler]", error);
      reply({ ok: false, error: error instanceof GameError ? error.message : "Erreur serveur." });
    }
  };
}

export function registerHandlers(io, store, flow, out) {
  // ------------------------------------------------------------ presence

  function attach(socket, room, player) {
    // Same session opened in a second tab: the old tab is disconnected.
    if (player.socketId && player.socketId !== socket.id) {
      const old = io.sockets.sockets.get(player.socketId);
      old?.emit(EVENTS.NOTICE, { text: "Session ouverte dans un autre onglet.", level: "error" });
      old?.disconnect(true);
    }
    clearTimeout(player.removalTimer);
    clearTimeout(room.cleanupTimer);
    player.socketId = socket.id;
    player.connected = true;
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
  }

  function detach(socket) {
    const room = store.get(socket.data.roomCode);
    const player = room?.players.find((p) => p.id === socket.data.playerId);
    socket.data.roomCode = null;
    socket.data.playerId = null;
    if (room) socket.leave(room.code);
    return { room, player };
  }

  function removeFromRoom(room, player) {
    store.removePlayer(room, player.id);
    if (room.players.length === 0) return store.delete(room);
    out.announce(room, `👋 ${player.name} a quitté la ville.`);
    out.state(room);
  }

  function scheduleCleanupIfEmpty(room) {
    if (room.players.some((p) => p.connected)) return;
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => store.delete(room), EMPTY_ROOM_TTL_MS);
  }

  function handleDisconnect(socket) {
    const { room, player } = detach(socket);
    if (!room || !player || player.socketId !== socket.id) return;

    player.connected = false;
    player.socketId = null;
    if (room.hostId === player.id) store.reassignHost(room);

    if (room.phase === PHASES.LOBBY) {
      // Keep the seat for a while in case it is just a page refresh.
      player.removalTimer = setTimeout(() => {
        if (!player.connected && store.get(room.code)) removeFromRoom(room, player);
      }, LOBBY_GRACE_MS);
    } else {
      out.announce(room, `📡 ${player.name} s'est déconnecté.`);
    }
    flow.afterPresenceChange(room);
    scheduleCleanupIfEmpty(room);
  }

  /** Removes lobby players who stayed offline (used after a restart). */
  function dropOfflineLobbyPlayers(room) {
    room.players.filter((p) => !p.connected).forEach((p) => removeFromRoom(room, p));
  }

  // ------------------------------------------------------------ events

  io.on("connection", (socket) => {
    /** The room and player behind this socket, or a GameError. */
    function current() {
      const room = store.get(socket.data.roomCode);
      const player = room?.players.find((p) => p.id === socket.data.playerId);
      if (!room || !player) throw new GameError("Tu n'es dans aucune ville.");
      return { room, player };
    }

    function leaveCurrentRoom() {
      const { room, player } = detach(socket);
      if (!room || !player) return;
      if (room.phase === PHASES.LOBBY || room.phase === PHASES.ENDED) {
        removeFromRoom(room, player);
      } else {
        player.connected = false;
        player.socketId = null;
        if (room.hostId === player.id) store.reassignHost(room);
        flow.playerLeft(room, player);
        scheduleCleanupIfEmpty(room);
      }
    }

    function enter(room, player) {
      attach(socket, room, player);
      out.syncHistory(room, player);
      out.state(room);
      return { code: room.code, sessionId: player.sessionId };
    }

    socket.on(EVENTS.ROOM_CREATE, safe(({ name }) => {
      leaveCurrentRoom();
      const { room, player } = store.create(name);
      return enter(room, player);
    }));

    socket.on(EVENTS.ROOM_JOIN, safe(({ code, name }) => {
      leaveCurrentRoom();
      const { room, player } = store.join(code, name);
      const result = enter(room, player);
      out.announce(room, `🚪 ${player.name} est arrivé en ville.`);
      return result;
    }));

    socket.on(EVENTS.ROOM_RESUME, safe(({ sessionId }) => {
      const found = store.resume(sessionId);
      if (!found) throw new GameError("Session expirée.");
      const { room, player } = found;
      if (socket.data.playerId && socket.data.playerId !== player.id) leaveCurrentRoom();
      const wasOffline = !player.connected;
      const result = enter(room, player);
      if (wasOffline && room.phase !== PHASES.LOBBY) {
        out.announce(room, `🔌 ${player.name} est de retour.`);
      }
      flow.afterPresenceChange(room);
      return result;
    }));

    socket.on(EVENTS.ROOM_LEAVE, safe(() => {
      leaveCurrentRoom();
    }));

    socket.on(EVENTS.ROOM_SETTINGS, safe(({ settings }) => {
      const { room, player } = current();
      if (player.id !== room.hostId) throw new GameError("Seul l'hôte peut régler la partie.");
      if (room.phase !== PHASES.LOBBY) throw new GameError("Réglages verrouillés pendant la partie.");
      if (!settings || typeof settings !== "object") throw new GameError("Réglages invalides.");

      for (const [key, [min, max]] of Object.entries(SETTINGS_BOUNDS)) {
        if (settings[key] === undefined) continue;
        const value = Math.round(Number(settings[key]));
        if (!Number.isFinite(value) || value < min || value > max) {
          throw new GameError(`Valeur invalide pour ${key} (${min}–${max}).`);
        }
        room.settings[key] = value;
      }
      if (typeof settings.revealRolesOnDeath === "boolean") {
        room.settings.revealRolesOnDeath = settings.revealRolesOnDeath;
      }
      out.state(room);
    }));

    socket.on(EVENTS.PLAYER_READY, safe(({ ready }) => {
      const { room, player } = current();
      if (room.phase !== PHASES.LOBBY) throw new GameError("La partie a déjà commencé.");
      player.ready = player.id === room.hostId ? true : Boolean(ready);
      out.state(room);
    }));

    socket.on(EVENTS.GAME_START, safe(() => {
      const { room, player } = current();
      flow.startGame(room, player);
    }));

    socket.on(EVENTS.GAME_RESTART, safe(() => {
      const { room, player } = current();
      flow.restart(room, player);
      dropOfflineLobbyPlayers(room);
    }));

    socket.on(EVENTS.NIGHT_ACTION, safe(({ targetId, kidnapId }) => {
      const { room, player } = current();
      flow.submitNightAction(room, player, {
        targetId: typeof targetId === "string" ? targetId : null,
        kidnapId: typeof kidnapId === "string" ? kidnapId : null,
      });
    }));

    socket.on(EVENTS.DAY_SKIP, safe(() => {
      const { room, player } = current();
      flow.skipDiscussion(room, player);
    }));

    socket.on(EVENTS.VOTE_CAST, safe(({ targetId }) => {
      const { room, player } = current();
      flow.castVote(room, player, typeof targetId === "string" ? targetId : null);
    }));

    socket.on(EVENTS.CHAT_SEND, safe(({ channel, text }) => {
      const { room, player } = current();
      if (!Object.values(CHANNELS).includes(channel)) throw new GameError("Canal inconnu.");
      const message = addPlayerMessage(room, player, channel, text);
      out.chat(room, message);
    }));

    socket.on("disconnect", () => handleDisconnect(socket));
  });
}
