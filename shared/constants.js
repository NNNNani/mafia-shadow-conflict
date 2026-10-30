// Shared contract between the server (Node) and the browser.
// Both sides import this file, so an event name can never differ between them.

/** Every Socket.IO event used by the game. See docs/EVENTS.md for payloads. */
export const EVENTS = Object.freeze({
  // Client -> server. Every one of these is sent with an acknowledgement
  // callback that receives { ok: true, data } or { ok: false, error }.
  ROOM_CREATE: "room:create",
  ROOM_JOIN: "room:join",
  ROOM_RESUME: "room:resume",
  ROOM_LEAVE: "room:leave",
  ROOM_SETTINGS: "room:settings",
  PLAYER_READY: "player:ready",
  GAME_START: "game:start",
  GAME_RESTART: "game:restart",
  NIGHT_ACTION: "night:action",
  DAY_SKIP: "day:skip",
  VOTE_CAST: "vote:cast",
  CHAT_SEND: "chat:send",

  // Server -> client.
  ROOM_STATE: "room:state",
  CHAT_MESSAGE: "chat:message",
  CHAT_HISTORY: "chat:history",
  NIGHT_RESULT: "night:result",
  NOTICE: "notice",
});

/** Game phases, in the order they normally happen. */
export const PHASES = Object.freeze({
  LOBBY: "lobby",
  ROLE_REVEAL: "roleReveal",
  NIGHT: "night",
  DAWN: "dawn",
  DISCUSSION: "discussion",
  VOTE: "vote",
  VERDICT: "verdict",
  ENDED: "ended",
});

/** Phases during which the village is awake. */
export const DAY_PHASES = Object.freeze([
  PHASES.DAWN,
  PHASES.DISCUSSION,
  PHASES.VOTE,
  PHASES.VERDICT,
]);

/** Phases of a running game (not lobby, not ended). */
export const GAME_PHASES = Object.freeze([
  PHASES.ROLE_REVEAL,
  PHASES.NIGHT,
  ...DAY_PHASES,
]);

export const CHANNELS = Object.freeze({
  LOBBY: "lobby",
  VILLAGE: "village",
  MAFIA: "mafia",
  DEAD: "dead",
  SYSTEM: "system",
});

export const TEAMS = Object.freeze({
  MAFIA: "mafia",
  CITY: "city",
});

export const LIMITS = Object.freeze({
  NAME_MAX: 20,
  CHAT_MAX: 300,
  CODE_LENGTH: 6,
});
