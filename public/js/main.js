// Application entry point: connects to the server, stores what it sends,
// and lets the router draw the right screen.
import { EVENTS, CHANNELS } from "/shared/constants.js";
import { createConnection } from "./net/socket.js";
import { createStore, initialState } from "./state/store.js";
import { createApi } from "./api.js";
import { createRouter } from "./router.js";
import { defaultChannel } from "./ui/chatPanel.js";
import { modal, toast } from "./ui/components.js";
import { homeScreen } from "./screens/home.js";
import { lobbyScreen } from "./screens/lobby.js";
import { gameScreen } from "./screens/game.js";
import { endScreen } from "./screens/end.js";

const store = createStore(initialState);
const connection = createConnection();
const api = createApi(connection, store);
const router = createRouter(
  document.getElementById("app"),
  { home: homeScreen, lobby: lobbyScreen, game: gameScreen, end: endScreen },
  { store, api }
);

// ------------------------------------------------------------- connection status

const CONNECTION_LABELS = {
  connecting: ["Connexion…", "bg-white/5 text-slate-400"],
  online: ["● En ligne", "bg-emerald-400/10 text-emerald-300"],
  offline: ["● Hors ligne — reconnexion…", "bg-blood-500/15 text-blood-400"],
};

function renderConnection(status) {
  const el = document.getElementById("connection");
  const [label, classes] = CONNECTION_LABELS[status];
  el.textContent = label;
  el.className = `chip ${classes}`;
}

connection.socket.on("connect", async () => {
  store.set({ connection: "online" });
  await api.resume(); // back to our seat after a refresh or a network cut
});
connection.socket.on("disconnect", () => store.set({ connection: "offline" }));

// ------------------------------------------------------------- server events

connection.on(EVENTS.ROOM_STATE, (room) => {
  const previous = store.get().room;
  const phaseChanged = previous?.phase !== room.phase;
  store.set({
    room,
    // On a new phase, open the most useful chat tab (e.g. Mafia at night).
    activeChannel: phaseChanged ? defaultChannel(room) : store.get().activeChannel,
  });
});

connection.on(EVENTS.CHAT_HISTORY, (history) => store.set({ chat: history }));

connection.on(EVENTS.CHAT_MESSAGE, (message) => {
  store.set((state) => {
    const chat = { ...state.chat, [message.channel]: [...state.chat[message.channel], message].slice(-150) };
    const unread = { ...state.unread };
    const countsAsUnread = message.channel !== CHANNELS.SYSTEM && message.channel !== state.activeChannel;
    if (countsAsUnread) unread[message.channel] = (unread[message.channel] || 0) + 1;
    return { chat, unread };
  });
});

connection.on(EVENTS.NIGHT_RESULT, (result) => modal({ title: result.title, body: result.text }));
connection.on(EVENTS.NOTICE, ({ text, level }) => toast(text, level));

// ------------------------------------------------------------- render loop

store.subscribe((state) => {
  renderConnection(state.connection);
  router.render(state);
});
router.render(store.get());
renderConnection("connecting");
