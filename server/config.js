// Game settings and server limits. Change the defaults here, not in the logic.

/** Minimum players to start. Override with MIN_PLAYERS=3 to test with fewer tabs. */
export const MIN_PLAYERS = Number(process.env.MIN_PLAYERS) || 5;
export const MAX_PLAYERS = 12;

/** Multiply every timer (0.1 = ten times faster). Used by automated tests. */
export const TIME_SCALE = Number(process.env.TIME_SCALE) || 1;

/** Settings the host can change in the lobby (in seconds). */
export const DEFAULT_SETTINGS = Object.freeze({
  nightSeconds: 45,
  discussionSeconds: 90,
  voteSeconds: 45,
  revealRolesOnDeath: true,
});

/** Allowed [min, max] for each numeric setting. */
export const SETTINGS_BOUNDS = Object.freeze({
  nightSeconds: [15, 180],
  discussionSeconds: [15, 300],
  voteSeconds: [15, 120],
});

/** Short fixed phases (in seconds). */
export const FIXED_PHASE_SECONDS = Object.freeze({
  roleReveal: 8,
  dawn: 7,
  verdict: 7,
});

/** How long a lobby player may stay disconnected before being removed. */
export const LOBBY_GRACE_MS = 30_000;

/** How long an empty room (nobody connected) is kept before deletion. */
export const EMPTY_ROOM_TTL_MS = 5 * 60_000;

/** Anti-spam: at most `max` chat messages per `windowMs` per player. */
export const CHAT_RATE = Object.freeze({ max: 5, windowMs: 5_000 });

/** Messages kept per channel (older ones are dropped). */
export const CHAT_HISTORY_MAX = 100;
