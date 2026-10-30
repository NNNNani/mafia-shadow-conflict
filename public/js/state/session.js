// Remembers the secret session id of this tab so a page refresh or a network
// cut can reconnect to the same seat. sessionStorage is per tab: two tabs = two players.
// It only stores an id; all game data comes from the server.

const KEY = "loupgarou.session";

export function saveSession(session) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* storage blocked: reconnection after refresh will not work, the game still does */
  }
}

export function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
