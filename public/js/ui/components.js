// Reusable UI pieces shared by every screen.
import { h, mount } from "./dom.js";
import { PHASES } from "/shared/constants.js";

// Full class names are written out so Tailwind keeps them in the build.
const AVATAR_COLORS = [
  "from-violet-400 to-violet-700",
  "from-amber-300 to-amber-600",
  "from-sky-400 to-sky-700",
  "from-emerald-400 to-emerald-700",
  "from-rose-400 to-rose-700",
  "from-indigo-400 to-indigo-700",
  "from-teal-300 to-teal-600",
  "from-orange-400 to-orange-700",
  "from-fuchsia-400 to-fuchsia-700",
  "from-lime-300 to-lime-600",
  "from-cyan-300 to-cyan-600",
  "from-pink-300 to-pink-600",
];

const SIZES = { sm: "h-8 w-8 text-sm", md: "h-11 w-11 text-base", lg: "h-14 w-14 text-xl" };

export function avatar(player, size = "md") {
  const color = AVATAR_COLORS[player.avatar % AVATAR_COLORS.length];
  return h(
    "span",
    {
      class: `relative inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${color} ${SIZES[size]} font-display font-extrabold text-night-950 shadow-card`,
      "aria-hidden": "true",
    },
    player.name.charAt(0).toUpperCase()
  );
}

export const PHASE_INFO = {
  [PHASES.LOBBY]: { label: "الردهة", icon: "🏡" },
  [PHASES.ROLE_REVEAL]: { label: "توزيع الأدوار", icon: "🎭" },
  [PHASES.NIGHT]: { label: "الليل", icon: "🌙" },
  [PHASES.DAWN]: { label: "الفجر", icon: "🌅" },
  [PHASES.DISCUSSION]: { label: "النقاش", icon: "💬" },
  [PHASES.VOTE]: { label: "التصويت", icon: "🗳️" },
  [PHASES.VERDICT]: { label: "الحكم", icon: "⚖️" },
  [PHASES.ENDED]: { label: "نهاية اللعبة", icon: "🏆" },
};

export function teamChip(team) {
  return team === "wolves"
    ? h("span", { class: "chip bg-blood-500/15 text-blood-400" }, "المستذئبون")
    : h("span", { class: "chip bg-sky-500/15 text-sky-300" }, "القرويون");
}

// ------------------------------------------------------------- countdown

/**
 * A text element that counts down to `phaseEndsAt` (server time).
 * `serverNow` corrects the difference between the server and browser clocks.
 */
export function countdown() {
  const el = h("span", { class: "font-display text-2xl font-extrabold tabular-nums text-gold-300", dir: "ltr" }, "--:--");
  let endsAt = null;
  let offset = 0;

  const tick = () => {
    if (!endsAt) return void (el.textContent = "--:--");
    const left = Math.max(0, Math.ceil((endsAt - (Date.now() + offset)) / 1000));
    el.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
    el.classList.toggle("text-blood-400", left <= 10);
    el.classList.toggle("animate-pulse-soft", left <= 10 && left > 0);
  };
  const interval = setInterval(tick, 250);

  return {
    el,
    update(room) {
      endsAt = room.phaseEndsAt;
      offset = room.serverNow - Date.now();
      tick();
    },
    destroy: () => clearInterval(interval),
  };
}

// ------------------------------------------------------------- toasts & modal

const TOAST_STYLES = {
  info: "border-violet-400/30 bg-night-800/95 text-slate-100",
  success: "border-emerald-400/40 bg-night-800/95 text-emerald-200",
  error: "border-blood-500/50 bg-night-800/95 text-blood-400",
};

export function toast(text, level = "info") {
  const el = h(
    "div",
    { class: `pointer-events-auto animate-rise rounded-xl border px-4 py-3 text-sm shadow-card ${TOAST_STYLES[level] || TOAST_STYLES.info}`, role: "status" },
    text
  );
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), 4000);
}

/** Shows a modal dialog. Returns a function that closes it. */
export function modal({ title, body, actionLabel = "فهمت" }) {
  const root = document.getElementById("modal-root");
  const close = () => {
    document.removeEventListener("keydown", onKey);
    root.replaceChildren();
  };
  const onKey = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", onKey);

  const button = h("button", { class: "btn-primary w-full", onClick: close }, actionLabel);
  mount(
    root,
    h(
      "div",
      { class: "fixed inset-0 z-40 flex items-center justify-center bg-night-950/80 p-4 backdrop-blur-sm", onClick: (e) => e.target === e.currentTarget && close() },
      h(
        "div",
        { class: "card w-full max-w-sm animate-flip p-6 text-center", role: "dialog", "aria-modal": "true", "aria-label": title },
        h("h2", { class: "font-display text-xl font-bold text-gold-300" }, title),
        h("div", { class: "mt-3 text-slate-300" }, body),
        h("div", { class: "mt-6" }, button)
      )
    )
  );
  button.focus();
  return close;
}

/** Disables a button while an async action runs, and shows errors as toasts. */
export async function busy(button, action) {
  button.disabled = true;
  try {
    return await action();
  } catch (error) {
    toast(error.message, "error");
    return undefined;
  } finally {
    button.disabled = false;
  }
}
