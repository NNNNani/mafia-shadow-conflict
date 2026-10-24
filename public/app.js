"use strict";

const socket = io();
const $ = (id) => document.getElementById(id);

const SESSION_KEY = "mafia.session";
const NAME_KEY = "mafia.name";

const screens = { entry: $("entry"), lobby: $("lobby"), game: $("game") };
const nameInput = $("playerName");
const codeInput = $("roomCode");
const startBtn = $("startBtn");

let S = null;                 // آخر حالة جات من السيرفر
let sel = { key: "", target: null, kidnap: null, vote: null };
let roleShown = false;
let seenResults = 0;
let lastPhaseKey = "";
let lastActionSig = "";
let lastChatCount = 0;

/* ------------------------------ أدوات ------------------------------ */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}

function showMessage(text) {
  $("message").textContent = text;
}

const loadSession = () => {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
};
const saveSession = (s) => localStorage.setItem(SESSION_KEY, JSON.stringify(s));
const clearSession = () => localStorage.removeItem(SESSION_KEY);

function show(name) {
  Object.entries(screens).forEach(([key, node]) =>
    node.classList.toggle("hidden", key !== name)
  );
  $("hero").classList.toggle("hidden", name === "game");
}

function resetLocalGameUi() {
  sel = { key: "", target: null, kidnap: null, vote: null };
  roleShown = false;
  seenResults = 0;
  lastPhaseKey = "";
  lastActionSig = "";
  lastChatCount = 0;
  $("roleCard").classList.add("pulse");
}

const nameOf = (id) => S?.players.find((p) => p.id === id)?.name || "؟";

function applyState(state) {
  const wasInGame = S && S.phase !== "lobby";
  S = state;

  if (!state) {
    resetLocalGameUi();
    show("entry");
    return;
  }
  if (state.phase === "lobby") {
    if (wasInGame) resetLocalGameUi();
    show("lobby");
    renderLobby(state);
  } else {
    show("game");
    renderGame(state);
  }
}

/* ------------------------------ Lobby ------------------------------ */

function renderLobby(state) {
  $("currentCode").textContent = state.code;
  $("playerCount").textContent = `${state.players.length} / ${state.maxPlayers}`;
  $("progressBar").style.width = `${(state.players.length / state.maxPlayers) * 100}%`;

  const list = $("playersList");
  list.replaceChildren();

  state.players.forEach((player) => {
    const card = el("div", "player-card");
    const avatar = el("div", "avatar", player.name.charAt(0).toUpperCase());
    const info = el("div", "player-info");
    const role = el(
      "div",
      "player-role",
      !player.connected ? "Déconnecté…" : player.isHost ? "Hôte de la ville" : "En attente"
    );
    info.append(el("div", "player-name", player.name + (player.id === state.youId ? " (toi)" : "")), role);
    card.append(avatar, info);
    list.append(card);
  });

  const isHost = state.hostId === state.youId;
  const ready = state.players.length >= state.minPlayers;

  startBtn.hidden = !isHost;
  startBtn.disabled = !ready;
  startBtn.textContent = ready
    ? "🚀 START GAME"
    : `EN ATTENTE (${state.players.length}/${state.minPlayers})`;

  $("lobbyMessage").textContent = ready
    ? isHost
      ? "La ville est prête. Lance la partie !"
      : "La ville est prête. L'hôte va lancer la partie."
    : `En attente de ${state.minPlayers - state.players.length} joueur(s)...`;
}

$("createBtn").addEventListener("click", () => {
  const name = checkName();
  if (!name) return;
  $("createBtn").disabled = true;

  socket.emit("room:create", name, (result) => {
    $("createBtn").disabled = false;
    if (!result?.ok) return showMessage(result?.message || "وقع خطأ.");
    showMessage("");
    resetLocalGameUi();
    saveSession({ code: result.state.code, token: result.token });
    applyState(result.state);
  });
});

$("joinBtn").addEventListener("click", () => {
  const name = checkName();
  if (!name) return;

  const code = codeInput.value.trim().toUpperCase();
  if (!code) {
    showMessage("دخل كود الغرفة.");
    codeInput.focus();
    return;
  }
  $("joinBtn").disabled = true;

  socket.emit("room:join", { name, code }, (result) => {
    $("joinBtn").disabled = false;
    if (!result?.ok) return showMessage(result?.message || "ما قدرناش ندخلوك للغرفة.");
    showMessage("");
    resetLocalGameUi();
    saveSession({ code: result.state.code, token: result.token });
    applyState(result.state);
  });
});

function checkName() {
  const name = nameInput.value.trim();
  if (!name) {
    showMessage("دخل الاسم ديالك أولاً.");
    nameInput.focus();
    return null;
  }
  localStorage.setItem(NAME_KEY, name);
  return name;
}

startBtn.addEventListener("click", () => {
  if (startBtn.disabled) return;
  startBtn.disabled = true;

  socket.emit("game:start", (result) => {
    if (!result?.ok) {
      toast(result?.message || "ما قدرناش نبداو.");
      startBtn.disabled = false;
    }
  });
});

$("copyBtn").addEventListener("click", async () => {
  const link = `${location.origin}/?room=${S?.code || ""}`;
  try {
    await navigator.clipboard.writeText(link);
    $("copyBtn").textContent = "Lien copié ✓";
  } catch {
    $("copyBtn").textContent = S?.code || "";
  }
  setTimeout(() => ($("copyBtn").textContent = "Copier le lien"), 2500);
});

function leave() {
  socket.emit("room:leave");
  clearSession();
  codeInput.value = "";
  $("playersList").replaceChildren();
  applyState(null);
  showMessage("خرجتي من الغرفة.");
}

$("leaveBtn").addEventListener("click", leave);
$("gameLeaveBtn").addEventListener("click", () => {
  if (confirm("واش بصح بغيتي تخرج؟ ما غاديش تقدر ترجع للعبة.")) leave();
});

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
});

/* ------------------------------ اللعبة ------------------------------ */

function renderGame(st) {
  const me = st.me;
  const key = `${st.phase}:${st.night}`;
  const first = lastPhaseKey === "";

  if (key !== lastPhaseKey) {
    lastPhaseKey = key;
    sel = {
      key,
      target: me.action?.targetId ?? null,
      kidnap: me.action?.kidnappedId ?? null,
      vote: me.vote ?? null
    };
    if (!first) {
      navigator.vibrate?.(150);
      if (st.phase === "night") toast("🌙 بدا الليل");
      if (st.phase === "day") toast("☀️ طلع النهار");
    }
  }

  if (me.results.length > seenResults && !first) toast("🕵️ وصلاتك معلومة سرية جديدة");
  seenResults = me.results.length;

  renderPhase(st);
  renderRoleCard(st);
  renderResults(st);
  renderChat(st);
  renderGamePlayers(st);
  renderLogs(st);
  renderHost(st);
  renderAction();
}

function renderPhase(st) {
  const me = st.me;
  const badge = $("phaseBadge");
  const sub = $("phaseSub");
  badge.className = `phase-badge ${st.phase}`;

  if (st.phase === "ended") {
    badge.textContent = st.winner === "city" ? "🏆 المدينة ربحات" : "🏆 المافيا ربحات";
    sub.textContent = me.role.team === st.winner ? "مبروك! فريقك ربح 🎉" : "حظ أوفر المرة الجاية.";
  } else if (st.phase === "night") {
    badge.textContent = `🌙 الليلة ${st.night}`;
    sub.textContent = !me.alive
      ? "نتا ميت — كتتفرج فقط 👻"
      : me.canAct ? "دير الاختيار ديالك بسرية." : "المدينة ناعسة... تسناو.";
  } else {
    badge.textContent = `☀️ النهار ${st.night}`;
    sub.textContent = !me.alive
      ? "نتا ميت — كتتفرج فقط 👻"
      : me.silenced ? "🤐 نتا مخطوف اليوم: ما تهضرش ولا تصوت." : "ناقشو وصوتو على المشتبه فيه.";
  }

  const p = st.progress;
  const bar = $("gameProgress");
  if (p && p.total > 0) {
    bar.style.width = `${(p.done / p.total) * 100}%`;
    $("progressText").textContent = `${p.done} / ${p.total} ${st.phase === "night" ? "دارو الاختيار" : "صوتو"}`;
  } else {
    bar.style.width = st.phase === "ended" ? "100%" : "0%";
    $("progressText").textContent = "";
  }
}

function renderRoleCard(st) {
  const me = st.me;
  const card = $("roleCard");
  card.classList.toggle("revealed", roleShown);
  card.classList.toggle("mafia", roleShown && me.role.team === "mafia");
  card.setAttribute("aria-expanded", String(roleShown));
  $("roleHint").textContent = me.alive ? "دورك السري" : "دورك السري (ميت ☠️)";

  if (!roleShown) {
    $("roleName").textContent = "اضغط باش تشوف دورك";
    $("roleDesc").textContent = "تأكد ما كيشوفك حد 👀";
    $("roleTeam").textContent = "";
    return;
  }
  $("roleName").textContent = me.role.name;
  $("roleDesc").textContent = me.role.description;
  $("roleTeam").textContent = me.teammates.length
    ? "فريقك: " + me.teammates.map((t) => `${t.name} (${t.role})${t.alive ? "" : " ☠️"}`).join("، ")
    : "";
}

$("roleCard").addEventListener("click", () => {
  roleShown = !roleShown;
  $("roleCard").classList.remove("pulse");
  if (S?.me) renderRoleCard(S);
});

function renderResults(st) {
  const results = st.me.results;
  $("resultsPanel").classList.toggle("hidden", results.length === 0);
  const list = $("resultsList");
  list.replaceChildren();
  results.forEach((r) => list.append(el("li", "", `${r.title} (ليلة ${r.night}) — ${r.message}`)));
}

function renderChat(st) {
  const visible = st.phase === "day";
  $("chatPanel").classList.toggle("hidden", !visible);
  if (!visible) return;

  const box = $("chatBox");
  box.replaceChildren();
  if (!st.chat.length) box.append(el("p", "hint", "ما كاين حتى رسالة بعد. بدا النقاش!"));
  st.chat.forEach((m) => {
    const row = el("div", "chat-msg" + (m.id === st.youId ? " mine" : ""));
    row.append(el("b", "", m.name), el("span", "", m.text));
    box.append(row);
  });
  if (st.chat.length !== lastChatCount) box.scrollTop = box.scrollHeight;
  lastChatCount = st.chat.length;

  const canTalk = st.me.alive && !st.me.silenced;
  $("chatInput").disabled = !canTalk;
  $("chatSend").disabled = !canTalk;
  $("chatInput").placeholder = canTalk ? "كتب هنا..." : "ما تقدرش تهضر";
}

function sendChat() {
  const input = $("chatInput");
  const text = input.value.trim();
  if (!text) return;
  socket.emit("chat:send", text);
  input.value = "";
  input.focus();
}
$("chatSend").addEventListener("click", sendChat);
$("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});

function renderGamePlayers(st) {
  const list = $("gamePlayers");
  list.replaceChildren();

  st.players.forEach((p) => {
    const card = el("div", "player-card" + (p.alive ? "" : " dead"));
    card.append(el("div", "avatar", p.name.charAt(0).toUpperCase()));

    const info = el("div", "player-info");
    info.append(el("div", "player-name", p.name + (p.id === st.youId ? " (نتا)" : "")));

    const tags = [];
    if (!p.alive) tags.push("☠️ ميت");
    if (p.alive && p.silenced) tags.push("🤐 مخطوف");
    if (!p.connected) tags.push("📴 مقطوع");
    if (p.isHost) tags.push("👑");
    if (p.role) tags.push(p.role);
    info.append(el("div", "player-role", tags.join(" · ") || "حي"));

    card.append(info);
    list.append(card);
  });
}

function renderLogs(st) {
  const list = $("logList");
  list.replaceChildren();
  [...st.logs].reverse().forEach((line) => list.append(el("li", "", line)));
}

function renderHost(st) {
  const isHost = st.hostId === st.youId;
  $("hostControls").classList.toggle("hidden", !isHost);
  $("forceBtn").classList.toggle("hidden", st.phase === "ended");
  $("resetBtn").classList.toggle("hidden", st.phase !== "ended");
}

$("forceBtn").addEventListener("click", () => {
  if (confirm("تكمل المرحلة دابا بالاختيارات اللي تسجلات؟")) socket.emit("game:force-next");
});
$("resetBtn").addEventListener("click", () => socket.emit("game:reset"));

/* ---------------------- لوحة الاختيار (ليل / تصويت) ---------------------- */

const NIGHT_TITLES = {
  boss: "🎩 اختار ضحية المافيا",
  mafia: "🔫 اقترح الضحية",
  doctor: "💉 شكون غادي تعالج؟",
  bodyguard: "🛡️ شكون غادي تحمي؟",
  detective: "🔎 شكون غادي تحقق معاه؟",
  spy: "🕶️ شكون غادي تتجسس عليه؟"
};

function chooser(st, selKey, disabledReason) {
  const grid = el("div", "choices");

  st.players.filter((p) => p.alive).forEach((p) => {
    const reason = disabledReason(p);
    const btn = el("button", "choice" + (sel[selKey] === p.id ? " selected" : ""));
    btn.type = "button";
    btn.append(el("span", "", p.name));
    if (reason) btn.append(el("small", "", reason));
    btn.disabled = Boolean(reason);
    btn.addEventListener("click", () => {
      sel[selKey] = sel[selKey] === p.id ? null : p.id;
      renderAction();
    });
    grid.append(btn);
  });
  return grid;
}

function renderAction() {
  const st = S;
  if (!st?.me) return;
  const me = st.me;

  const sig = JSON.stringify([
    st.phase, st.night, st.winner, me.alive, me.silenced, me.canAct, me.action, me.vote,
    me.blockedId, me.mafiaPick, st.players.map((p) => [p.id, p.alive]),
    sel.target, sel.kidnap, sel.vote
  ]);
  if (sig === lastActionSig) return;
  lastActionSig = sig;

  const box = $("actionPanel");
  box.replaceChildren();

  if (st.phase === "ended") {
    box.append(
      el("h2", "", "🏁 سالات اللعبة"),
      el("p", "hint", "الأدوار الحقيقية ديال الجميع باينين فلائحة اللاعبين.")
    );
    return;
  }

  if (!me.alive) {
    box.append(
      el("h2", "", "👻 نتا ميت"),
      el("p", "hint", "تقدر تتفرج وتتبع اللعبة، ولكن ما تقدرش تدير شي حاجة. ما تعطيش معلومات للأحياء!")
    );
    return;
  }

  if (st.phase === "night") {
    if (!me.canAct) {
      box.append(
        el("h2", "", "😴 الليل"),
        el("p", "hint", "ما عندك حتى قدرة الليلة. تسنا النهار وحلل شكون مشكوك فيه.")
      );
      return;
    }
    renderNightAction(st, box);
  } else if (me.silenced) {
    box.append(
      el("h2", "", "🤐 مخطوف"),
      el("p", "hint", "المافيا خطفاتك: ما تقدرش تهضر ولا تصوت هاد النهار.")
    );
  } else {
    renderVote(st, box);
  }
}

function renderNightAction(st, box) {
  const me = st.me;
  const role = me.role.key;
  const mafiaTeam = me.role.team === "mafia";

  box.append(el("h2", "", NIGHT_TITLES[role]));
  if (role === "mafia") box.append(el("p", "hint", "اقتراحك كيوصل لزعيم المافيا وهو اللي كيقرر."));
  if (role === "boss" && me.mafiaPick) {
    box.append(el("p", "hint", `المافيا كيقترح: ${nameOf(me.mafiaPick)}`));
  }

  box.append(
    chooser(st, "target", (p) => {
      if (p.id === st.youId && role !== "doctor") return "نتا";
      if (mafiaTeam && me.teammates.some((t) => t.id === p.id)) return "فريقك";
      if (role === "doctor" && p.id === me.blockedId) return "عالجتيه البارح";
      return "";
    })
  );

  if (role === "boss") {
    box.append(el("h2", "sub-title", "🤐 شكون غادي تخطف؟ (اختياري)"));
    box.append(chooser(st, "kidnap", (p) => (p.id === st.youId ? "نتا" : "")));
  }

  const unchanged =
    me.action &&
    me.action.targetId === sel.target &&
    (me.action.kidnappedId || null) === (sel.kidnap || null);

  const confirmBtn = el(
    "button",
    "button primary",
    unchanged ? "✓ الاختيار مسجل" : me.action ? "✏️ بدل الاختيار" : "✅ أكد الاختيار"
  );
  confirmBtn.type = "button";
  confirmBtn.disabled = !sel.target || unchanged;
  confirmBtn.addEventListener("click", () => {
    socket.emit("game:night-action", { targetId: sel.target, kidnappedId: sel.kidnap });
  });
  box.append(confirmBtn);

  if (me.action) {
    box.append(el("p", "hint", `تسجل: ${nameOf(me.action.targetId)}. تقدر تبدل حتى يكمل الليل.`));
  }
}

function renderVote(st, box) {
  const me = st.me;
  box.append(
    el("h2", "", "🗳️ صوت على المشتبه فيه"),
    chooser(st, "vote", (p) => (p.id === st.youId ? "نتا" : ""))
  );

  const unchanged = me.vote && me.vote === sel.vote;
  const btn = el("button", "button primary", unchanged ? "✓ صوتك مسجل" : me.vote ? "✏️ بدل التصويت" : "🗳️ صوّت");
  btn.type = "button";
  btn.disabled = !sel.vote || unchanged;
  btn.addEventListener("click", () => socket.emit("game:vote", sel.vote));
  box.append(btn);

  if (me.vote) box.append(el("p", "hint", `صوتك الحالي: ${nameOf(me.vote)}. تقدر تبدلو حتى يصوت الجميع.`));
}

/* ------------------------------ السوكيت ------------------------------ */

socket.on("game:state", applyState);
socket.on("game:notice", toast);

socket.on("connect", () => {
  const session = loadSession();
  if (!session) return;

  socket.emit("session:resume", session, (result) => {
    if (result?.ok) {
      applyState(result.state);
    } else {
      clearSession();
      applyState(null);
    }
  });
});

socket.on("disconnect", () => toast("📴 تقطع الاتصال... كنحاولو نرجعو"));

/* ------------------------------ بداية ------------------------------ */

nameInput.value = localStorage.getItem(NAME_KEY) || "";
const roomFromLink = new URLSearchParams(location.search).get("room");
if (roomFromLink) codeInput.value = roomFromLink.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
