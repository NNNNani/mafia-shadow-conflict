// Room and player storage (in memory). This module is the single owner of
// every room object; other modules receive rooms from it and never create their own.
import crypto from "node:crypto";
import { CHANNELS, LIMITS, PHASES } from "../shared/constants.js";
import { DEFAULT_SETTINGS, MAX_PLAYERS } from "./config.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I confusion
const AVATAR_COUNT = 12;

/** An error whose message can be shown to the player. */
export class GameError extends Error {}

/** Trims, collapses spaces, removes control characters and limits the length. */
export function cleanName(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.NAME_MAX);
}

export function cleanCode(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, LIMITS.CODE_LENGTH);
}

function emptyChat() {
  return Object.fromEntries(Object.values(CHANNELS).map((c) => [c, []]));
}

export class RoomStore {
  #rooms = new Map(); // code -> room
  #sessions = new Map(); // sessionId -> { code, playerId }

  get(code) {
    return this.#rooms.get(cleanCode(code)) || null;
  }

  all() {
    return [...this.#rooms.values()];
  }

  /** Creates a room with its host. Returns { room, player }. */
  create(rawName) {
    const name = cleanName(rawName);
    if (!name) throw new GameError("Entre ton nom d'abord.");

    const room = {
      code: this.#newCode(),
      hostId: null,
      phase: PHASES.LOBBY,
      settings: { ...DEFAULT_SETTINGS },
      players: [],
      round: 0,
      phaseEndsAt: null,
      nightActions: {},
      votes: {},
      lastHealTargetId: null,
      lastNight: null,
      lastVerdict: null,
      winner: null,
      journal: [],
      chat: emptyChat(),
      // Server-only fields (never sent to clients):
      timer: null,
      phaseToken: 0,
      cleanupTimer: null,
    };
    this.#rooms.set(room.code, room);

    const player = this.#addPlayer(room, name);
    room.hostId = player.id;
    player.ready = true;
    return { room, player };
  }

  /** Adds a player to an existing lobby. Returns { room, player }. */
  join(rawCode, rawName) {
    const name = cleanName(rawName);
    if (!name) throw new GameError("Entre ton nom d'abord.");

    const room = this.get(rawCode);
    if (!room) throw new GameError("Aucune ville avec ce code.");
    if (room.phase !== PHASES.LOBBY) throw new GameError("La partie a déjà commencé.");
    if (room.players.length >= MAX_PLAYERS) throw new GameError("La ville est complète.");

    const taken = room.players.some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new GameError("Ce nom est déjà pris dans cette ville.");

    return { room, player: this.#addPlayer(room, name) };
  }

  /** Finds the room and player behind a secret session id (used to reconnect). */
  resume(sessionId) {
    const entry = typeof sessionId === "string" && this.#sessions.get(sessionId);
    if (!entry) return null;
    const room = this.#rooms.get(entry.code);
    const player = room?.players.find((p) => p.id === entry.playerId);
    return player ? { room, player } : null;
  }

  removePlayer(room, playerId) {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return;
    room.players = room.players.filter((p) => p.id !== playerId);
    this.#sessions.delete(player.sessionId);
    if (room.hostId === playerId) this.reassignHost(room);
  }

  /** Gives the host badge to the first connected player (or the first player). */
  reassignHost(room) {
    const next = room.players.find((p) => p.connected) || room.players[0];
    room.hostId = next ? next.id : null;
    if (next && room.phase === PHASES.LOBBY) next.ready = true;
  }

  delete(room) {
    clearTimeout(room.timer);
    clearTimeout(room.cleanupTimer);
    room.players.forEach((p) => {
      clearTimeout(p.removalTimer);
      this.#sessions.delete(p.sessionId);
    });
    this.#rooms.delete(room.code);
  }

  #addPlayer(room, name) {
    const usedAvatars = new Set(room.players.map((p) => p.avatar));
    let avatar = 0;
    while (usedAvatars.has(avatar) && avatar < AVATAR_COUNT - 1) avatar++;

    const player = {
      id: crypto.randomUUID(), // public id, visible to everyone
      sessionId: crypto.randomUUID(), // secret, only sent to this player
      socketId: null,
      name,
      avatar,
      connected: true,
      ready: false,
      role: null,
      alive: true,
      silenced: false,
      death: null,
      results: [],
      chatTimes: [],
      removalTimer: null,
    };
    room.players.push(player);
    this.#sessions.set(player.sessionId, { code: room.code, playerId: player.id });
    return player;
  }

  #newCode() {
    let code;
    do {
      code = Array.from(
        { length: LIMITS.CODE_LENGTH },
        () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
      ).join("");
    } while (this.#rooms.has(code));
    return code;
  }
}
