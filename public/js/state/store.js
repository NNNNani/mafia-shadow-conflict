// Client-side store. It only mirrors what the server sends: the server stays
// the single source of truth for the game. Screens subscribe and re-render.

export function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();

  return {
    get: () => state,

    /** Merges a partial object (or the result of a function of the state). */
    set(patch) {
      const changes = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...changes };
      listeners.forEach((listener) => listener(state));
    },

    /** Returns a function that removes the listener. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const initialState = {
  connection: "connecting", // "connecting" | "online" | "offline"
  room: null, // last room:state received from the server
  chat: { lobby: [], village: [], mafia: [], dead: [], system: [] },
  unread: {}, // channel -> number of unseen messages
  activeChannel: null, // chat tab the player is looking at
};
