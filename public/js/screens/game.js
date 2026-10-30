// Game screen: phase + timer, secret role, players, night actions, votes, journal, chat.
import { PHASES } from "/shared/constants.js";
import { h, mount } from "../ui/dom.js";
import { PHASE_INFO, avatar, busy, countdown, teamChip } from "../ui/components.js";
import { createChatPanel } from "../ui/chatPanel.js";

const ABILITY_TEXT = {
  kill: ["🐺 اختر ضحية الليلة", "اختيارك يظهر لباقي الذئاب. الضحية هي اللاعب الذي يختاره أكبر عدد من الذئاب."],
  heal: ["💉 من تريد أن تحمي الليلة؟", "إذا هاجمته الذئاب سينجو. لا يمكنك حماية الشخص نفسه ليلتين متتاليتين."],
  investigate: ["🔍 مع من تريد التحقيق؟", "ستعرف سرّاً هل هذا اللاعب مستذئب أم لا."],
};

const DEATH_CAUSE = { wolves: "افترسته الذئاب", vote: "أُقصي بالتصويت", left: "غادر اللعبة" };

const nameOf = (room, id) => room.players.find((p) => p.id === id)?.name ?? "?";

// ------------------------------------------------------------- player card

function statusChips(room, player) {
  const chips = [];
  if (player.id === room.me.id) chips.push(h("span", { class: "chip bg-gold-400/15 text-gold-300" }, "أنت"));
  if (player.isHost) chips.push(h("span", { class: "chip bg-white/5 text-slate-300", title: "المضيف" }, "👑"));
  if (!player.connected) chips.push(h("span", { class: "chip bg-white/5 text-slate-400", title: "غير متصل" }, "📡"));
  if (player.role && player.id !== room.me.id) {
    chips.push(h("span", { class: "chip bg-blood-500/15 text-blood-400" }, `${player.role.emoji} ${player.role.name}`));
  }
  return chips;
}

/** Extra line under the name: votes received, or the wolves' picks at night. */
function cardFootnote(room, player) {
  if (room.phase === PHASES.VOTE && room.voteCounts?.[player.id]) {
    const voters = Object.entries(room.votes).filter(([, t]) => t === player.id).map(([v]) => nameOf(room, v));
    return h("p", { class: "mt-1 truncate text-xs text-gold-300" }, `🗳️ ${room.voteCounts[player.id]} · ${voters.join("، ")}`);
  }
  const picks = room.me.night?.teamPicks;
  if (picks) {
    const pickers = Object.entries(picks).filter(([, t]) => t === player.id).map(([p]) => nameOf(room, p));
    if (pickers.length) return h("p", { class: "mt-1 truncate text-xs text-blood-400" }, `🎯 ${pickers.join("، ")}`);
  }
  if (!player.alive && player.death) {
    return h("p", { class: "mt-1 text-xs text-slate-500" }, `${DEATH_CAUSE[player.death.cause]} · الجولة ${player.death.round}`);
  }
  return null;
}

function playerCard(room, player, { selectable, selected, onSelect }) {
  const base = "card flex w-full items-center gap-3 p-3 text-start transition";
  const look = !player.alive
    ? "opacity-45 grayscale"
    : selected
      ? "border-gold-400 shadow-glow"
      : selectable
        ? "cursor-pointer hover:border-gold-400/50 hover:bg-night-800"
        : "";

  const content = [
    avatar(player),
    h(
      "div",
      { class: "min-w-0 flex-1" },
      h("p", { class: `truncate font-semibold ${player.alive ? "text-slate-100" : "line-through text-slate-400"}` }, player.alive ? player.name : `☠️ ${player.name}`),
      h("div", { class: "mt-1 flex flex-wrap gap-1" }, statusChips(room, player)),
      cardFootnote(room, player)
    ),
  ];

  return selectable
    ? h("button", { type: "button", class: `${base} ${look}`, "aria-pressed": String(selected), onClick: () => onSelect(player.id) }, content)
    : h("div", { class: `${base} ${look}` }, content);
}

// ------------------------------------------------------------- screen

export function gameScreen(root, ctx) {
  const { api, store } = ctx;
  const chat = createChatPanel(ctx);
  const timer = countdown();

  // Local, not-yet-confirmed choices. Reset when the phase changes.
  let ui = { phaseKey: "", target: null, vote: null, showRole: true };

  const phaseIcon = h("span", { class: "text-3xl", "aria-hidden": "true" });
  const phaseTitle = h("h1", { class: "font-display text-2xl font-bold text-slate-50" });
  const phaseSub = h("p", { class: "text-sm text-slate-400" });
  const actionPanel = h("section", { class: "card p-5", "aria-live": "polite" });
  const playersGrid = h("ul", { class: "grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3", "aria-label": "اللاعبون" });
  const roleBox = h("section", { class: "card p-5", "aria-label": "دوري" });
  const journalList = h("ol", { class: "scroll-thin max-h-64 space-y-1.5 overflow-y-auto text-sm" });

  root.append(
    h(
      "div",
      { class: "grid gap-6 lg:grid-cols-[1fr_380px]" },
      h(
        "div",
        { class: "space-y-6" },
        h(
          "header",
          { class: "card flex items-center gap-4 p-5" },
          phaseIcon,
          h("div", { class: "flex-1" }, phaseTitle, phaseSub),
          h("div", { class: "text-end" }, h("p", { class: "label mb-0" }, "الوقت المتبقي"), timer.el)
        ),
        actionPanel,
        playersGrid,
        h("section", { class: "card p-5" }, h("h2", { class: "label" }, "سجل القرية"), journalList)
      ),
      h("aside", { class: "space-y-6" }, roleBox, chat.el)
    )
  );

  let lastRoom = null;

  /** Re-renders after a local choice (the server state did not change). */
  function rerender() {
    lastRoom = null;
    update(store.get());
  }

  function select(id) {
    const room = store.get().room;
    if (room.phase === PHASES.VOTE) ui.vote = id;
    else ui.target = id;
    rerender();
  }

  const title = (text) => h("h2", { class: "font-display text-xl font-bold text-gold-300" }, text);

  // ----------------------------------------------------------- panels

  function nightPanel(room) {
    const night = room.me.night;
    if (!room.me.alive) return [h("p", { class: "text-slate-300" }, "🪦 تراقب الليل من العالم الآخر.")];
    if (!night) {
      return [
        h("p", { class: "text-lg text-slate-300" }, "😴 أنت نائم… القرية غارقة في الظلام."),
        h("p", { class: "mt-1 text-sm text-slate-500" }, "الأدوار الخاصة تتحرك في الخفاء."),
      ];
    }

    const [heading, help] = ABILITY_TEXT[night.ability];
    const sent = night.myAction;
    const confirm = h("button", { class: "btn-primary", disabled: !ui.target }, sent ? "تغيير اختياري" : "تأكيد");
    confirm.addEventListener("click", () => busy(confirm, () => api.nightAction(ui.target)));

    return [
      title(heading),
      h("p", { class: "mt-1 text-sm text-slate-400" }, help),
      h(
        "div",
        { class: "mt-4 flex flex-wrap items-center gap-3" },
        h("p", { class: "text-sm text-slate-300" }, "الهدف: ", h("strong", { class: "text-slate-50" }, ui.target ? nameOf(room, ui.target) : "—")),
        confirm
      ),
      sent ? h("p", { class: "mt-3 text-sm text-emerald-300" }, `✓ تم إرسال اختيارك: ${nameOf(room, sent.targetId)}. يمكنك تغييره ما دام الليل مستمراً.`) : null,
    ];
  }

  function dawnPanel(room) {
    const night = room.lastNight;
    const lines = night?.deaths.length
      ? night.deaths.map(({ playerId }) => {
          const p = room.players.find((x) => x.id === playerId);
          return h("li", { class: "text-lg" }, `☠️ ${p.name}`, p.role ? ` — ${p.role.emoji} ${p.role.name}` : "");
        })
      : [h("li", { class: "text-lg text-emerald-300" }, night?.attackBlocked ? "💉 أنقذ الطبيب الضحية! لم يمت أحد." : "😮‍💨 لم يمت أحد هذه الليلة.")];
    return [title("الشمس تشرق على القرية…"), h("ul", { class: "mt-3 space-y-1" }, lines)];
  }

  function discussionPanel(room) {
    const skip = room.me.isHost ? h("button", { class: "btn-secondary mt-4" }, "⏭️ الانتقال إلى التصويت") : null;
    skip?.addEventListener("click", () => busy(skip, api.skipDiscussion));
    return [
      title("النقاش مفتوح"),
      h("p", { class: "mt-1 text-slate-400" }, "شارك شكوكك في دردشة القرية. من هو المستذئب؟"),
      skip,
    ];
  }

  function votePanel(room) {
    if (!room.me.canVote) return [title("القرية تصوّت"), h("p", { class: "mt-1 text-slate-400" }, "الموتى لا يصوّتون.")];

    const confirm = h("button", { class: "btn-primary", disabled: !ui.vote || ui.vote === room.me.myVote }, "تأكيد التصويت");
    confirm.addEventListener("click", () => busy(confirm, () => api.vote(ui.vote)));
    const withdraw = room.me.myVote ? h("button", { class: "btn-ghost" }, "سحب صوتي") : null;
    withdraw?.addEventListener("click", () => busy(withdraw, async () => { ui.vote = null; await api.vote(null); }));

    return [
      title("🗳️ من يجب أن يغادر القرية؟"),
      h("p", { class: "mt-1 text-sm text-slate-400" }, "اضغط على لاعب ثم أكّد. في حالة التعادل لا يُقصى أحد."),
      h(
        "div",
        { class: "mt-4 flex flex-wrap items-center gap-3" },
        h("p", { class: "text-sm text-slate-300" }, "صوتك: ", h("strong", { class: "text-slate-50" }, room.me.myVote ? nameOf(room, room.me.myVote) : "لا أحد")),
        confirm,
        withdraw
      ),
    ];
  }

  function verdictPanel(room) {
    const v = room.lastVerdict;
    let text = "⚖️ لا أصوات: لم يُقصَ أحد.";
    if (v?.eliminatedId) {
      const p = room.players.find((x) => x.id === v.eliminatedId);
      text = `⚖️ تم إقصاء ${p.name}${p.role ? ` — كان ${p.role.emoji} ${p.role.name}` : ""}.`;
    } else if (v?.tie) text = "⚖️ تعادل في الأصوات: لم يُقصَ أحد اليوم.";
    return [title("الحكم"), h("p", { class: "mt-2 text-lg" }, text), h("p", { class: "mt-1 text-sm text-slate-500" }, "سيحلّ الليل قريباً…")];
  }

  function revealPanel(room) {
    const role = room.me.role;
    const mates = room.players.filter((p) => p.id !== room.me.id && p.role?.team === "wolves");
    return [
      h(
        "div",
        { class: "animate-flip text-center" },
        h("p", { class: "eyebrow" }, "دورك السري"),
        h("div", { class: "mt-3 text-6xl", "aria-hidden": "true" }, role.emoji),
        h("h2", { class: "mt-2 font-display text-3xl font-bold text-slate-50" }, role.name),
        h("div", { class: "mt-2" }, teamChip(role.team)),
        h("p", { class: "mx-auto mt-3 max-w-md text-slate-300" }, role.description),
        mates.length ? h("p", { class: "mt-3 text-sm text-blood-400" }, `رفاقك الذئاب: ${mates.map((p) => p.name).join("، ")}`) : null,
        h("p", { class: "mt-4 text-xs text-slate-500" }, "لا تُظهر شاشتك لأحد. الليل سيحلّ قريباً.")
      ),
    ];
  }

  function renderActionPanel(room) {
    const panels = {
      [PHASES.ROLE_REVEAL]: revealPanel,
      [PHASES.NIGHT]: nightPanel,
      [PHASES.DAWN]: dawnPanel,
      [PHASES.DISCUSSION]: discussionPanel,
      [PHASES.VOTE]: votePanel,
      [PHASES.VERDICT]: verdictPanel,
    };
    const deadBanner = !room.me.alive
      ? h("p", { class: "mb-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-400" }, "🪦 لقد متّ. يمكنك متابعة اللعبة والتحدث في المقبرة.")
      : null;
    mount(actionPanel, deadBanner, (panels[room.phase] || (() => []))(room));
  }

  function renderRoleBox(room) {
    const role = room.me.role;
    const toggle = h("button", { class: "btn-ghost px-3 py-1 text-xs" }, ui.showRole ? "إخفاء" : "إظهار");
    toggle.addEventListener("click", () => { ui.showRole = !ui.showRole; rerender(); });

    const results = room.me.results.length
      ? h("ul", { class: "mt-4 space-y-2 border-t border-white/10 pt-4" },
          [...room.me.results].reverse().map((r) =>
            h("li", { class: "text-sm" }, h("span", { class: "text-xs text-slate-500" }, `الليلة ${r.round} · ${r.title}`), h("p", { class: "text-slate-100" }, r.text))))
      : null;

    mount(
      roleBox,
      h("div", { class: "flex items-center justify-between" }, h("h2", { class: "label mb-0" }, "دوري"), toggle),
      ui.showRole
        ? h("div", { class: "mt-3 flex gap-3" },
            h("span", { class: "text-4xl", "aria-hidden": "true" }, role.emoji),
            h("div", {}, h("p", { class: "font-display text-lg font-bold text-slate-50" }, role.name, " "), teamChip(role.team), h("p", { class: "mt-1 text-sm text-slate-400" }, role.description)))
        : h("p", { class: "mt-3 text-sm text-slate-500" }, "الدور مخفي."),
      ui.showRole ? results : null
    );
  }

  function renderPlayers(room) {
    let selectableIds = [];
    let selectedId = null;
    if (room.phase === PHASES.NIGHT && room.me.night) {
      selectableIds = room.me.night.targetIds;
      selectedId = ui.target;
    } else if (room.phase === PHASES.VOTE && room.me.canVote) {
      selectableIds = room.players.filter((p) => p.alive && p.id !== room.me.id).map((p) => p.id);
      selectedId = ui.vote;
    }

    const sorted = [...room.players].sort((a, b) => Number(b.alive) - Number(a.alive));
    mount(
      playersGrid,
      sorted.map((p) => h("li", {}, playerCard(room, p, {
        selectable: selectableIds.includes(p.id),
        selected: p.id === selectedId,
        onSelect: select,
      })))
    );
  }

  function update(state) {
    chat.update(state);
    // Chat-only changes keep the same room object: no need to redraw the board.
    if (state.room === lastRoom) return;
    lastRoom = state.room;

    const room = state.room;
    const phaseKey = `${room.phase}:${room.round}`;
    if (phaseKey !== ui.phaseKey) {
      ui = { ...ui, phaseKey, target: room.me.night?.myAction?.targetId ?? null, vote: room.me.myVote };
    }

    const info = PHASE_INFO[room.phase];
    phaseIcon.textContent = info.icon;
    phaseTitle.textContent = room.round ? `${info.label} · الجولة ${room.round}` : info.label;
    const alive = room.players.filter((p) => p.alive).length;
    phaseSub.textContent = `${alive} لاعب على قيد الحياة من أصل ${room.players.length} · القرية ${room.code}`;

    timer.update(room);
    renderActionPanel(room);
    renderPlayers(room);
    renderRoleBox(room);
    mount(journalList, [...room.journal].reverse().map((e) =>
      h("li", { class: "text-slate-300" }, h("span", { class: "me-2 text-xs text-slate-500" }, `ج${e.round}`), e.text)));
  }

  return { update, destroy: () => timer.destroy() };
}
