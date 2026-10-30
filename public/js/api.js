// Every action the player can ask the server for. Screens call these
// functions; they never emit socket events themselves.
import { EVENTS } from "/shared/constants.js";
import { clearSession, loadSession, saveSession } from "./state/session.js";
import { initialState } from "./state/store.js";

export function createApi(connection, store) {
  const { request } = connection;

  async function enterRoom(event, payload) {
    const data = await request(event, payload);
    saveSession({ sessionId: data.sessionId, code: data.code });
    history.replaceState(null, "", `/?code=${data.code}`);
    return data;
  }

  return {
    createRoom: (name) => enterRoom(EVENTS.ROOM_CREATE, { name }),
    joinRoom: (code, name) => enterRoom(EVENTS.ROOM_JOIN, { code, name }),

    /** Reconnects this tab to its seat after a refresh or network cut. */
    async resume() {
      const session = loadSession();
      if (!session?.sessionId) return false;
      try {
        await request(EVENTS.ROOM_RESUME, { sessionId: session.sessionId });
        return true;
      } catch {
        clearSession();
        store.set({ room: null });
        return false;
      }
    },

    async leave() {
      clearSession();
      // Tell the server first so no late room:state brings the old screen back.
      await request(EVENTS.ROOM_LEAVE).catch(() => {});
      history.replaceState(null, "", "/");
      store.set({ room: null, chat: initialState.chat, unread: {}, activeChannel: null });
    },

    setReady: (ready) => request(EVENTS.PLAYER_READY, { ready }),
    updateSettings: (settings) => request(EVENTS.ROOM_SETTINGS, { settings }),
    startGame: () => request(EVENTS.GAME_START),
    restartGame: () => request(EVENTS.GAME_RESTART),
    nightAction: (targetId) => request(EVENTS.NIGHT_ACTION, { targetId }),
    skipDiscussion: () => request(EVENTS.DAY_SKIP),
    vote: (targetId) => request(EVENTS.VOTE_CAST, { targetId }),
    sendChat: (channel, text) => request(EVENTS.CHAT_SEND, { channel, text }),
  };
}
