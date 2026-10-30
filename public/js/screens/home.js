// Home screen: create a city or join one with its code.
import { LIMITS } from "/shared/constants.js";
import { h } from "../ui/dom.js";
import { busy } from "../ui/components.js";

const INTRO = [
  ["🌙", "La nuit", "La Mafia choisit une victime. Le Médecin, le Garde, le Détective et l'Espion agissent en secret."],
  ["💬", "Le jour", "Le village découvre les morts, débat dans le chat et cherche les menteurs."],
  ["🗳️", "Le vote", "Chacun vote. Le plus désigné est éliminé, et une égalité épargne tout le monde."],
];

export function homeScreen(root, { api }) {
  const presetCode = new URLSearchParams(location.search).get("code") || "";

  const nameInput = h("input", {
    id: "playerName", class: "input", maxlength: String(LIMITS.NAME_MAX),
    placeholder: "Ex. Don Vito", autocomplete: "nickname", required: true,
  });
  const codeInput = h("input", {
    id: "roomCode", class: "input font-display uppercase tracking-[0.4em]", maxlength: String(LIMITS.CODE_LENGTH),
    placeholder: "A1B2C3", autocomplete: "off", value: presetCode.toUpperCase(),
  });
  const error = h("p", { class: "min-h-5 text-sm text-blood-400", role: "alert" });

  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.replace(/[^a-z0-9]/gi, "").slice(0, LIMITS.CODE_LENGTH).toUpperCase();
  });

  function readName() {
    const name = nameInput.value.trim();
    if (!name) {
      error.textContent = "Entre ton nom d'abord.";
      nameInput.focus();
    }
    return name;
  }

  const createButton = h("button", { type: "button", class: "btn-primary w-full py-3" }, "Créer une ville");
  const joinButton = h("button", { type: "submit", class: "btn-secondary w-full py-3" }, "Rejoindre");

  createButton.addEventListener("click", () => {
    const name = readName();
    if (name) busy(createButton, () => api.createRoom(name));
  });

  const joinForm = h(
    "form",
    { class: "space-y-3" },
    h("label", { class: "label", for: "roomCode" }, "Code de la ville"),
    codeInput,
    joinButton
  );
  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = readName();
    if (!name) return;
    if (codeInput.value.length !== LIMITS.CODE_LENGTH) {
      error.textContent = "Le code fait 6 caractères.";
      return codeInput.focus();
    }
    busy(joinButton, () => api.joinRoom(codeInput.value, name));
  });

  root.append(
    h(
      "div",
      { class: "grid items-center gap-10 py-6 lg:grid-cols-[1.1fr_1fr] lg:py-14" },
      h(
        "section",
        { class: "animate-rise" },
        h("p", { class: "eyebrow" }, "Une ville. Des secrets. Un traître ?"),
        h(
          "h1",
          { class: "mt-4 font-display text-5xl font-extrabold leading-[1.05] text-slate-50 sm:text-6xl" },
          "Shadow ",
          h("span", { class: "bg-gradient-to-r from-gold-200 to-gold-500 bg-clip-text text-transparent" }, "Conflict")
        ),
        h("p", { class: "mt-5 max-w-md text-lg text-slate-400" }, "La nuit cache la vérité. Le jour révèle les suspects. Joue à plusieurs, chacun sur son écran."),
        h(
          "ul",
          { class: "mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3" },
          INTRO.map(([icon, title, text]) =>
            h(
              "li",
              { class: "card p-4" },
              h("div", { class: "text-2xl", "aria-hidden": "true" }, icon),
              h("h2", { class: "mt-2 font-display font-bold text-gold-300" }, title),
              h("p", { class: "mt-1 text-sm text-slate-400" }, text)
            )
          )
        )
      ),
      h(
        "section",
        { class: "card animate-rise space-y-5 p-6 sm:p-8", "aria-label": "Entrer en ville" },
        h("div", {}, h("label", { class: "label", for: "playerName" }, "Ton nom"), nameInput),
        createButton,
        h(
          "div",
          { class: "flex items-center gap-3 text-xs uppercase tracking-widest text-slate-500" },
          h("span", { class: "h-px flex-1 bg-white/10" }), "ou", h("span", { class: "h-px flex-1 bg-white/10" })
        ),
        joinForm,
        error
      )
    )
  );

  nameInput.focus();
  return { update() {}, destroy() {} };
}
