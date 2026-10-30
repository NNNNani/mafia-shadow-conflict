// Chat channels: who may read, who may write, validation and anti-spam.
// This module only stores messages; the broadcaster decides who receives them.
import crypto from "node:crypto";
import { CHANNELS, DAY_PHASES, GAME_PHASES, LIMITS, PHASES } from "../shared/constants.js";
import { CHAT_HISTORY_MAX, CHAT_RATE } from "./config.js";
import { isMafia } from "./roles.js";
import { GameError } from "./rooms.js";

/** Can this player receive messages of this channel? */
export function canRead(room, player, channel) {
  switch (channel) {
    case CHANNELS.SYSTEM:
    case CHANNELS.LOBBY:
    case CHANNELS.VILLAGE:
      return true;
    case CHANNELS.MAFIA:
      return Boolean(player.role) && player.alive && isMafia(player);
    case CHANNELS.DEAD:
      return Boolean(player.role) && !player.alive;
    default:
      return false;
  }
}

/** Returns why the player cannot write in the channel, or null if they can. */
export function writeBlocker(room, player, channel) {
  switch (channel) {
    case CHANNELS.LOBBY:
      return [PHASES.LOBBY, PHASES.ENDED].includes(room.phase)
        ? null
        : "Le salon est fermé pendant la partie.";
    case CHANNELS.VILLAGE:
      if (!DAY_PHASES.includes(room.phase)) return "Le village dort : on ne parle que le jour.";
      if (!player.alive) return "Les morts ne parlent plus au village.";
      if (player.silenced) return "Tu as été kidnappé : silence jusqu'à ce soir.";
      return null;
    case CHANNELS.MAFIA:
      if (!canRead(room, player, channel)) return "Canal réservé à la Mafia vivante.";
      return room.phase === PHASES.NIGHT ? null : "La Mafia ne se parle que la nuit.";
    case CHANNELS.DEAD:
      if (!canRead(room, player, channel)) return "Canal réservé aux morts.";
      return GAME_PHASES.includes(room.phase) ? null : "La partie est terminée.";
    default:
      return "Canal inconnu.";
  }
}

/** Removes control characters and extra spaces. Returns "" for invalid input. */
export function cleanMessage(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, LIMITS.CHAT_MAX);
}

function isRateLimited(player, now) {
  player.chatTimes = player.chatTimes.filter((t) => now - t < CHAT_RATE.windowMs);
  if (player.chatTimes.length >= CHAT_RATE.max) return true;
  player.chatTimes.push(now);
  return false;
}

function store(room, message) {
  const list = room.chat[message.channel];
  list.push(message);
  if (list.length > CHAT_HISTORY_MAX) list.shift();
  return message;
}

/** Validates and stores a player message. Throws GameError when refused. */
export function addPlayerMessage(room, player, channel, rawText) {
  const blocker = writeBlocker(room, player, channel);
  if (blocker) throw new GameError(blocker);

  const text = cleanMessage(rawText);
  if (!text) throw new GameError("Message vide.");
  if (isRateLimited(player, Date.now())) throw new GameError("Doucement ! Attends quelques secondes.");

  return store(room, {
    id: crypto.randomUUID(),
    channel,
    kind: "player",
    author: { id: player.id, name: player.name, avatar: player.avatar },
    text,
    ts: Date.now(),
  });
}

/** Stores a server announcement visible to everyone in the room. */
export function addSystemMessage(room, text) {
  return store(room, {
    id: crypto.randomUUID(),
    channel: CHANNELS.SYSTEM,
    kind: "system",
    author: null,
    text,
    ts: Date.now(),
  });
}

/** Every message this player is allowed to read, grouped by channel. */
export function historyFor(room, player) {
  const history = {};
  for (const channel of Object.values(CHANNELS)) {
    history[channel] = canRead(room, player, channel) ? room.chat[channel] : [];
  }
  return history;
}

/** Empties the in-game channels (used when a new game starts). */
export function clearGameChannels(room) {
  room.chat[CHANNELS.VILLAGE] = [];
  room.chat[CHANNELS.MAFIA] = [];
  room.chat[CHANNELS.DEAD] = [];
}
