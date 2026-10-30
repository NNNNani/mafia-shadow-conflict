// End screen: winning team, every role revealed, statistics, replay options.
import { h, mount } from "../ui/dom.js";
import { avatar, busy, teamChip } from "../ui/components.js";
import { createChatPanel } from "../ui/chatPanel.js";

const CAUSE = { mafia: "Assassiné", bodyguard: "Mort en protégeant", vote: "Éliminé au vote", left: "A quitté" };

function stat(label, value) {
  return h("div", { class: "card p-4 text-center" },
    h("p", { class: "font-display text-3xl font-extrabold text-gold-300" }, String(value)),
    h("p", { class: "mt-1 text-xs uppercase tracking-widest text-slate-400" }, label));
}

export function endScreen(root, ctx) {
  const { api } = ctx;
  const chat = createChatPanel(ctx);
  const banner = h("section", { class: "card animate-flip p-8 text-center" });
  const stats = h("div", { class: "grid grid-cols-2 gap-3 sm:grid-cols-4" });
  const table = h("ul", { class: "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" });
  const journal = h("ol", { class: "scroll-thin max-h-72 space-y-1.5 overflow-y-auto text-sm" });
  const restartButton = h("button", { class: "btn-primary w-full py-3" }, "🔁 Nouvelle partie (retour au salon)");
  const leaveButton = h("button", { class: "btn-ghost w-full" }, "Quitter la ville");
  const waitText = h("p", { class: "text-center text-sm text-slate-400" }, "L'hôte peut relancer une partie avec les mêmes joueurs.");

  restartButton.addEventListener("click", () => busy(restartButton, api.restartGame));
  leaveButton.addEventListener("click", () => api.leave());

  root.append(
    h("div", { class: "grid gap-6 lg:grid-cols-[1fr_380px]" },
      h("div", { class: "space-y-6" },
        banner,
        stats,
        h("section", { class: "card space-y-4 p-6" }, h("h2", { class: "font-display text-lg font-bold" }, "Les rôles révélés"), table),
        h("section", { class: "card p-6" }, h("h2", { class: "label" }, "Résumé de la partie"), journal)),
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

      const cityWon = room.winner === "city";
      const myTeam = room.me.role?.team;
      mount(banner,
        h("div", { class: "text-6xl", "aria-hidden": "true" }, cityWon ? "🏙️" : "🎩"),
        h("p", { class: "eyebrow mt-4" }, "Fin de partie"),
        h("h1", { class: `mt-2 font-display text-4xl font-extrabold ${cityWon ? "text-sky-300" : "text-blood-400"}` },
          cityWon ? "La ville a gagné" : "La Mafia a gagné"),
        myTeam ? h("p", { class: "mt-3 text-lg text-slate-300" }, myTeam === room.winner ? "🎉 Victoire pour ton camp !" : "Ton camp a perdu cette fois.") : null);

      const survivors = room.players.filter((p) => p.alive);
      mount(stats,
        stat("Tours joués", room.round),
        stat("Survivants", survivors.length),
        stat("Morts", room.players.length - survivors.length),
        stat("Mafia restante", survivors.filter((p) => p.role?.team === "mafia").length));

      const ordered = [...room.players].sort((a, b) => Number(b.alive) - Number(a.alive));
      mount(table, ordered.map((p) =>
        h("li", { class: `card flex items-center gap-3 p-3 ${p.alive ? "" : "opacity-60"}` },
          avatar(p),
          h("div", { class: "min-w-0 flex-1" },
            h("p", { class: "truncate font-semibold text-slate-100" }, p.alive ? p.name : `☠️ ${p.name}`),
            h("p", { class: "text-xs text-slate-400" }, p.alive ? "Survivant" : `${CAUSE[p.death?.cause] || "Mort"} · tour ${p.death?.round}`)),
          p.role ? h("div", { class: "text-right" }, h("p", { class: "text-sm" }, `${p.role.emoji} ${p.role.name}`), teamChip(p.role.team)) : null)));

      mount(journal, room.journal.map((e) =>
        h("li", { class: "text-slate-300" }, h("span", { class: "mr-2 text-xs text-slate-500" }, `T${e.round}`), e.text)));

      restartButton.hidden = !room.me.isHost;
      waitText.hidden = room.me.isHost;
    },
    destroy() {},
  };
}
