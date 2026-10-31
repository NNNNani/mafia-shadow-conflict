// Lobby: room code, players, ready status, host settings, start button, lobby chat.
import { h, mount } from "../ui/dom.js";
import { avatar, busy, toast } from "../ui/components.js";
import { createChatPanel } from "../ui/chatPanel.js";

const SETTING_FIELDS = [
  ["nightSeconds", "الليل", 15, 180],
  ["discussionSeconds", "النقاش", 15, 300],
  ["voteSeconds", "التصويت", 15, 120],
];

function lobbyPlayerCard(player) {
  return h(
    "li",
    { class: "card flex items-center gap-3 p-3" },
    h("span", { class: "relative" },
      avatar(player),
      h("span", {
        class: `absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-night-850 ${player.connected ? "bg-emerald-400" : "bg-slate-500"}`,
        title: player.connected ? "متصل" : "غير متصل",
      })
    ),
    h(
      "div",
      { class: "min-w-0 flex-1" },
      h("p", { class: "truncate font-semibold text-slate-100" }, player.name),
      h("p", { class: "text-xs text-slate-500" }, player.connected ? "متصل" : "يعيد الاتصال…")
    ),
    player.isHost
      ? h("span", { class: "chip bg-gold-400/15 text-gold-300" }, "👑 المضيف")
      : player.ready
        ? h("span", { class: "chip bg-emerald-400/15 text-emerald-300" }, "✓ جاهز")
        : h("span", { class: "chip bg-white/5 text-slate-400" }, "في الانتظار")
  );
}

export function lobbyScreen(root, ctx) {
  const { api } = ctx;
  const chat = createChatPanel(ctx);

  const codeText = h("strong", { class: "font-display text-3xl tracking-[0.35em] text-gold-300", dir: "ltr" });
  const copyButton = h("button", { class: "btn-ghost px-3 py-1.5 text-xs" }, "نسخ الرابط");
  const countText = h("span", { class: "text-sm text-slate-400" });
  const progress = h("div", { class: "h-full rounded-full bg-gradient-to-l from-violet-500 to-gold-400 transition-all" });
  const playersList = h("ul", { class: "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" });
  const statusText = h("p", { class: "text-sm text-slate-400", role: "status" });
  const readyButton = h("button", { class: "btn-secondary w-full py-3" });
  const startButton = h("button", { class: "btn-primary w-full py-3" }, "🚀 ابدأ اللعبة");
  const leaveButton = h("button", { class: "btn-ghost w-full" }, "مغادرة القرية");
  const settingsBox = h("div", { class: "space-y-3" });
  let settingsKey = "";

  // Wi-Fi invite link. "localhost" only works on the host's computer, so when the
  // host opened the game that way we ask the server for its network address.
  const wifiLink = h("code", { class: "block break-all text-sm text-gold-300", dir: "ltr" }, "…");
  const wifiBox = h(
    "div",
    { class: "w-full rounded-xl border border-gold-400/20 bg-gold-400/5 px-4 py-3" },
    h("p", { class: "text-xs text-slate-400" }, "📶 على نفس شبكة الـWi-Fi، يفتح اللاعبون الآخرون هذا الرابط:"),
    wifiLink
  );
  let baseUrl = location.origin;
  const inviteLink = () => `${baseUrl}/?code=${codeText.textContent}`;
  const isLocalhost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname);
  if (isLocalhost) {
    fetch("/api/network")
      .then((res) => res.json())
      .then(({ urls }) => {
        if (urls[0]) baseUrl = urls[0];
        else wifiBox.append(h("p", { class: "mt-1 text-xs text-blood-400" }, "لم يتم العثور على شبكة: صِل هذا الحاسوب بالـWi-Fi."));
        wifiLink.textContent = inviteLink();
      })
      .catch(() => (wifiLink.textContent = inviteLink()));
  }

  copyButton.addEventListener("click", async () => {
    const link = inviteLink();
    try {
      await navigator.clipboard.writeText(link);
      toast("تم نسخ رابط الدعوة ✓", "success");
    } catch {
      toast(`شارك هذا الرابط: ${link}`);
    }
  });
  readyButton.addEventListener("click", () => {
    const me = ctx.store.get().room.players.find((p) => p.id === ctx.store.get().room.me.id);
    busy(readyButton, () => api.setReady(!me.ready));
  });
  startButton.addEventListener("click", () => busy(startButton, api.startGame));
  leaveButton.addEventListener("click", () => api.leave());

  function renderSettings(room) {
    const key = JSON.stringify([room.settings, room.me.isHost]);
    if (key === settingsKey) return;
    settingsKey = key;

    const rows = SETTING_FIELDS.map(([field, label, min, max]) => {
      const value = room.settings[field];
      const output = h("span", { class: "w-14 text-end text-sm tabular-nums text-gold-300" }, `${value} ث`);
      const slider = h("input", {
        type: "range", min: String(min), max: String(max), step: "5", value: String(value),
        class: "flex-1 accent-amber-400", disabled: !room.me.isHost, "aria-label": `مدة ${label}`,
      });
      slider.addEventListener("input", () => (output.textContent = `${slider.value} ث`));
      slider.addEventListener("change", () =>
        api.updateSettings({ [field]: Number(slider.value) }).catch((e) => toast(e.message, "error"))
      );
      return h("label", { class: "flex items-center gap-3" }, h("span", { class: "w-16 text-sm text-slate-300" }, label), slider, output);
    });

    const reveal = h("input", {
      type: "checkbox", class: "h-4 w-4 accent-amber-400",
      checked: room.settings.revealRolesOnDeath, disabled: !room.me.isHost,
    });
    reveal.addEventListener("change", () =>
      api.updateSettings({ revealRolesOnDeath: reveal.checked }).catch((e) => toast(e.message, "error"))
    );

    mount(
      settingsBox,
      h("p", { class: "label" }, room.me.isHost ? "الإعدادات (المضيف)" : "إعدادات المضيف"),
      rows,
      h("label", { class: "flex items-center gap-3 text-sm text-slate-300" }, reveal, "كشف دور اللاعبين الموتى")
    );
  }

  root.append(
    h(
      "div",
      { class: "grid gap-6 lg:grid-cols-[1fr_380px]" },
      h(
        "div",
        { class: "space-y-6" },
        h(
          "section",
          { class: "card flex flex-wrap items-center justify-between gap-4 p-6" },
          h("div", {}, h("p", { class: "eyebrow" }, "غرفة الانتظار"), h("h1", { class: "mt-1 font-display text-2xl font-bold text-slate-50" }, "القرية تستيقظ")),
          h("div", { class: "text-end" }, h("p", { class: "label" }, "رمز القرية"), codeText, h("div", { class: "mt-2" }, copyButton)),
          wifiBox
        ),
        h(
          "section",
          { class: "card space-y-4 p-6", "aria-label": "اللاعبون" },
          h("div", { class: "flex items-center justify-between" }, h("h2", { class: "font-display text-lg font-bold" }, "اللاعبون"), countText),
          h("div", { class: "h-2 overflow-hidden rounded-full bg-white/5" }, progress),
          playersList,
          statusText
        )
      ),
      h(
        "aside",
        { class: "space-y-6" },
        h("section", { class: "card space-y-4 p-6" }, settingsBox, readyButton, startButton, leaveButton),
        chat.el
      )
    )
  );

  return {
    update(state) {
      const room = state.room;
      const me = room.players.find((p) => p.id === room.me.id);
      const count = room.players.length;
      const waitingFor = room.players.filter((p) => !p.ready || !p.connected);

      codeText.textContent = room.code;
      wifiLink.textContent = inviteLink();
      countText.textContent = `${count} / ${room.maxPlayers} (الحد الأدنى ${room.minPlayers})`;
      progress.style.width = `${Math.min(100, (count / room.maxPlayers) * 100)}%`;
      mount(playersList, room.players.map(lobbyPlayerCard));

      statusText.textContent =
        count < room.minPlayers
          ? `عدد اللاعبين الناقص للبدء: ${room.minPlayers - count}.`
          : waitingFor.length
            ? `في انتظار: ${waitingFor.map((p) => p.name).join("، ")}.`
            : "الجميع جاهز. يمكن للمضيف بدء اللعبة.";

      readyButton.hidden = room.me.isHost;
      readyButton.textContent = me?.ready ? "لست جاهزاً بعد" : "✓ أنا جاهز";
      startButton.hidden = !room.me.isHost;
      startButton.disabled = count < room.minPlayers || waitingFor.length > 0;

      renderSettings(room);
      chat.update(state);
    },
    destroy() {},
  };
}
