// End screen: winning team, every role revealed, statistics, replay options.
import { h, mount } from "../ui/dom.js";
import { avatar, busy, teamChip } from "../ui/components.js";
import { createChatPanel } from "../ui/chatPanel.js";

const CAUSE = { wolves: "افترسته الذئاب", vote: "أُقصي بالتصويت", left: "غادر اللعبة" };

function stat(label, value) {
  return h("div", { class: "card p-4 text-center" },
    h("p", { class: "font-display text-3xl font-bold text-gold-300" }, String(value)),
    h("p", { class: "mt-1 text-xs text-slate-400" }, label));
}

export function endScreen(root, ctx) {
  const { api } = ctx;
  const chat = createChatPanel(ctx);
  const banner = h("section", { class: "card animate-flip p-8 text-center" });
  const stats = h("div", { class: "grid grid-cols-2 gap-3 sm:grid-cols-4" });
  const table = h("ul", { class: "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" });
  const journal = h("ol", { class: "scroll-thin max-h-72 space-y-1.5 overflow-y-auto text-sm" });
  const restartButton = h("button", { class: "btn-primary w-full py-3" }, "🔁 لعبة جديدة (العودة إلى الردهة)");
  const leaveButton = h("button", { class: "btn-ghost w-full" }, "مغادرة القرية");
  const waitText = h("p", { class: "text-center text-sm text-slate-400" }, "يمكن للمضيف بدء لعبة جديدة بنفس اللاعبين.");

  restartButton.addEventListener("click", () => busy(restartButton, api.restartGame));
  leaveButton.addEventListener("click", () => api.leave());

  root.append(
    h("div", { class: "grid gap-6 lg:grid-cols-[1fr_380px]" },
      h("div", { class: "space-y-6" },
        banner,
        stats,
        h("section", { class: "card space-y-4 p-6" }, h("h2", { class: "font-display text-lg font-bold" }, "كشف الأدوار"), table),
        h("section", { class: "card p-6" }, h("h2", { class: "label" }, "ملخص اللعبة"), journal)),
      h("aside", { class: "space-y-6" },
        h("section", { class: "card space-y-3 p-6" }, restartButton, waitText, leaveButton),
        chat.el))
  );

  let lastRoom = null;

  return {
    update(state) {
      chat.update(state);
      if (state.room === lastRoom) return;
      lastRoom = state.room;
      const room = state.room;

      const villageWon = room.winner === "village";
      const myTeam = room.me.role?.team;
      mount(banner,
        h("div", { class: "text-6xl", "aria-hidden": "true" }, villageWon ? "🏡" : "🐺"),
        h("p", { class: "eyebrow mt-4" }, "نهاية اللعبة"),
        h("h1", { class: `mt-2 font-display text-4xl font-bold ${villageWon ? "text-sky-300" : "text-blood-400"}` },
          villageWon ? "فاز القرويون" : "فاز المستذئبون"),
        myTeam ? h("p", { class: "mt-3 text-lg text-slate-300" }, myTeam === room.winner ? "🎉 فريقك انتصر!" : "خسر فريقك هذه المرة.") : null);

      const survivors = room.players.filter((p) => p.alive);
      mount(stats,
        stat("عدد الجولات", room.round),
        stat("الناجون", survivors.length),
        stat("الموتى", room.players.length - survivors.length),
        stat("الذئاب الباقية", survivors.filter((p) => p.role?.team === "wolves").length));

      const ordered = [...room.players].sort((a, b) => Number(b.alive) - Number(a.alive));
      mount(table, ordered.map((p) =>
        h("li", { class: `card flex items-center gap-3 p-3 ${p.alive ? "" : "opacity-60"}` },
          avatar(p),
          h("div", { class: "min-w-0 flex-1" },
            h("p", { class: "truncate font-semibold text-slate-100" }, p.alive ? p.name : `☠️ ${p.name}`),
            h("p", { class: "text-xs text-slate-400" }, p.alive ? "نجا" : `${CAUSE[p.death?.cause] || "مات"} · الجولة ${p.death?.round}`)),
          p.role ? h("div", { class: "text-end" }, h("p", { class: "text-sm" }, `${p.role.emoji} ${p.role.name}`), teamChip(p.role.team)) : null)));

      mount(journal, room.journal.map((e) =>
        h("li", { class: "text-slate-300" }, h("span", { class: "me-2 text-xs text-slate-500" }, `ج${e.round}`), e.text)));

      restartButton.hidden = !room.me.isHost;
      waitText.hidden = room.me.isHost;
    },
    destroy() {},
  };
}
