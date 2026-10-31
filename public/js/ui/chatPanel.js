// Chat panel: one tab per channel the player can read, message bubbles,
// unread badges, and an input that is disabled when writing is not allowed.
import { CHANNELS, PHASES } from "/shared/constants.js";
import { h, mount } from "./dom.js";
import { avatar, toast } from "./components.js";

const CHANNEL_INFO = {
  [CHANNELS.LOBBY]: { label: "الردهة", icon: "🏡" },
  [CHANNELS.VILLAGE]: { label: "القرية", icon: "☀️" },
  [CHANNELS.WOLVES]: { label: "الذئاب", icon: "🐺" },
  [CHANNELS.DEAD]: { label: "المقبرة", icon: "🪦" },
};

/** Channels shown as tabs for this player right now. */
export function visibleChannels(room) {
  if (room.phase === PHASES.LOBBY || room.phase === PHASES.ENDED) return [CHANNELS.LOBBY];
  const channels = [CHANNELS.VILLAGE];
  const myRole = room.me.role;
  if (myRole?.team === "wolves" && room.me.alive) channels.push(CHANNELS.WOLVES);
  if (!room.me.alive) channels.push(CHANNELS.DEAD);
  return channels;
}

/** The tab to open by default: the wolves' tab at night for werewolves, otherwise lobby/village. */
export function defaultChannel(room) {
  const channels = visibleChannels(room);
  if (room.phase === PHASES.NIGHT && channels.includes(CHANNELS.WOLVES)) return CHANNELS.WOLVES;
  return channels[0];
}

/** Messages of a tab. System announcements appear in the lobby and village tabs. */
function messagesFor(chat, channel) {
  if (channel === CHANNELS.LOBBY || channel === CHANNELS.VILLAGE) {
    return [...chat[channel], ...chat[CHANNELS.SYSTEM]].sort((a, b) => a.ts - b.ts);
  }
  return chat[channel];
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("ar-MA", { hour: "2-digit", minute: "2-digit" });
}

function messageBubble(message, myId) {
  if (message.kind === "system") {
    return h("li", { class: "my-2 text-center text-xs italic text-gold-300/90" }, message.text);
  }
  const mine = message.author.id === myId;
  const tint = message.channel === CHANNELS.WOLVES
    ? "bg-blood-500/15 border-blood-500/30"
    : message.channel === CHANNELS.DEAD
      ? "bg-slate-500/10 border-slate-400/20"
      : mine ? "bg-gold-400/15 border-gold-400/30" : "bg-white/5 border-white/10";

  return h(
    "li",
    { class: `my-2 flex items-end gap-2 animate-rise ${mine ? "flex-row-reverse" : ""}` },
    avatar(message.author, "sm"),
    h(
      "div",
      { class: `max-w-[80%] rounded-2xl border px-3 py-2 ${tint}` },
      h(
        "div",
        { class: `mb-0.5 flex gap-2 text-[11px] ${mine ? "justify-end" : ""}` },
        h("span", { class: "font-semibold text-slate-200" }, mine ? "أنت" : message.author.name),
        h("time", { class: "text-slate-500", datetime: new Date(message.ts).toISOString() }, formatTime(message.ts))
      ),
      h("p", { class: "whitespace-pre-wrap break-words text-sm text-slate-100", dir: "auto" }, message.text)
    )
  );
}

/**
 * @param ctx { store, api }
 * Returns { el, update(state) }.
 */
export function createChatPanel({ store, api }) {
  const tabs = h("div", { class: "flex gap-1 overflow-x-auto border-b border-white/10 p-2", role: "tablist" });
  const list = h("ul", { class: "scroll-thin h-72 overflow-y-auto px-3 py-2 lg:h-[26rem]", "aria-live": "polite" });
  const input = h("input", { class: "input py-2 text-sm", maxlength: "300", "aria-label": "رسالة", dir: "rtl" });
  const sendButton = h("button", { class: "btn-primary px-3 py-2", type: "submit", "aria-label": "إرسال" }, "➤");
  const form = h("form", { class: "flex gap-2 border-t border-white/10 p-2" }, input, sendButton);
  const el = h(
    "section",
    { class: "card flex flex-col overflow-hidden", "aria-label": "الدردشة" },
    tabs,
    list,
    form
  );

  let renderedKey = "";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    const channel = store.get().activeChannel;
    if (!text || !channel) return;
    sendButton.disabled = true;
    try {
      await api.sendChat(channel, text);
      input.value = "";
    } catch (error) {
      toast(error.message, "error");
    } finally {
      sendButton.disabled = false;
      update(store.get());
      input.focus();
    }
  });

  function selectChannel(channel) {
    const unread = { ...store.get().unread, [channel]: 0 };
    store.set({ activeChannel: channel, unread });
  }

  function renderTabs(channels, active, unread) {
    mount(
      tabs,
      channels.map((channel) => {
        const info = CHANNEL_INFO[channel];
        const count = unread[channel] || 0;
        return h(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": String(channel === active),
            class: `btn px-3 py-1.5 text-xs ${channel === active ? "bg-white/10 text-gold-300" : "text-slate-400 hover:bg-white/5"}`,
            onClick: () => selectChannel(channel),
          },
          `${info.icon} ${info.label}`,
          count > 0 && channel !== active
            ? h("span", { class: "chip bg-blood-500 text-white", "aria-label": `${count} غير مقروءة` }, count)
            : null
        );
      })
    );
  }

  function renderMessages(state, channel) {
    const messages = messagesFor(state.chat, channel);
    const key = `${channel}:${messages.length}:${messages.at(-1)?.id ?? ""}`;
    if (key === renderedKey) return;
    renderedKey = key;

    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const empty = h("li", { class: "py-10 text-center text-sm text-slate-500" }, "لا توجد رسائل بعد.");
    mount(list, messages.length ? messages.map((m) => messageBubble(m, state.room.me.id)) : empty);
    if (nearBottom || messages.at(-1)?.author?.id === state.room.me.id) list.scrollTop = list.scrollHeight;
  }

  function update(state) {
    const room = state.room;
    const channels = visibleChannels(room);
    let active = state.activeChannel;
    if (!channels.includes(active)) {
      active = defaultChannel(room);
      queueMicrotask(() => selectChannel(active));
    }

    renderTabs(channels, active, state.unread);
    renderMessages(state, active);

    const rights = room.me.chat[active];
    input.disabled = !rights?.canWrite;
    sendButton.disabled = !rights?.canWrite;
    input.placeholder = rights?.canWrite ? "اكتب رسالة…" : rights?.reason || "قراءة فقط";
  }

  return { el, update };
}
