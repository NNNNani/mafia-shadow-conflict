"use strict";

const express = require("express");
const http = require("http");
const os = require("os");
const crypto = require("crypto");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

/* ------------------------------------------------------------------ */
/* الإعدادات                                                            */
/* ------------------------------------------------------------------ */

const rooms = new Map();
const MAX_PLAYERS = 10;
// للتجريب بلا 10 ناس:  MIN_PLAYERS=6 npm start   (الافتراضي = 10)
const MIN_PLAYERS = Math.min(
  MAX_PLAYERS,
  Math.max(5, Number(process.env.MIN_PLAYERS) || MAX_PLAYERS)
);
const LOBBY_GRACE_MS = 20_000;       // مهلة الرجوع فالـlobby قبل الطرد
const EMPTY_ROOM_MS = 30 * 60_000;   // الغرفة الفارغة كتتمسح من بعد 30 دقيقة

const ROLES = [
  "boss", "mafia", "detective", "doctor",
  "spy", "bodyguard",
  "citizen", "citizen", "citizen", "citizen"
];

const NIGHT_ROLES = ["boss", "mafia", "doctor", "bodyguard", "detective", "spy"];

const ROLE_INFO = {
  boss: {
    name: "زعيم المافيا",
    team: "mafia",
    description: "اختار ضحية المافيا وحدد اللاعب المخطوف (ما يهضرش ولا يصوت النهار). المحقق كيشوفك مواطن."
  },
  mafia: {
    name: "المافيا",
    team: "mafia",
    description: "عاون زعيم المافيا فاختيار الضحية. إلا مات الزعيم، اختيارك هو اللي كيتنفذ."
  },
  detective: {
    name: "المحقق",
    team: "city",
    description: "اختار لاعب باش تحقق واش من المافيا. الزعيم كيبان ليك مواطن."
  },
  doctor: {
    name: "الطبيب",
    team: "city",
    description: "اختار لاعب باش تنقذو من القتل (تقدر تعالج راسك). ما تقدرش تعالج نفس اللاعب ليلتين متتاليتين."
  },
  spy: {
    name: "الجاسوس",
    team: "city",
    description: "اختار لاعب باش تعرف واش هو زعيم المافيا."
  },
  bodyguard: {
    name: "الحارس الشخصي",
    team: "city",
    description: "اختار لاعب تحميه هاد الليلة. إلا تستهدف، كتموت بلاصتو. ما تقدرش تحمي راسك."
  },
  citizen: {
    name: "مواطن",
    team: "city",
    description: "حلل الأحداث، ناقش مع اللاعبين وصوت على المشتبه فيه."
  }
};

/* ------------------------------------------------------------------ */
/* أدوات                                                                */
/* ------------------------------------------------------------------ */

function makeCode() {
  let code;
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

const newId = () => crypto.randomBytes(4).toString("hex");
const newToken = () => crypto.randomBytes(16).toString("hex");

function cleanName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 20);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const findPlayer = (room, id) => room.players.find(p => p.id === id);
const alivePlayers = room => room.players.filter(p => p.alive);
const aliveWithRole = (room, role) =>
  room.players.find(p => p.alive && p.role === role);
const isMafiaTeam = p => ROLE_INFO[p.role]?.team === "mafia";

function addPlayer(room, name) {
  const player = {
    id: newId(),          // معرّف عمومي (كيبان للجميع)
    token: newToken(),    // سر خاص باللاعب (كيرجع بيه إلا تقطع الاتصال)
    socketId: null,
    name,
    connected: true,
    alive: true,
    silenced: false,
    revealed: false,
    role: null,
    action: null,
    vote: null,
    results: [],
    timer: null
  };
  room.players.push(player);
  return player;
}

function resetPlayerForGame(p) {
  p.alive = true;
  p.silenced = false;
  p.revealed = false;
  p.action = null;
  p.vote = null;
  p.results = [];
}

/* ------------------------------------------------------------------ */
/* الحالة المرسلة لكل لاعب (كل واحد كيشوف غير اللي يخصو)                */
/* ------------------------------------------------------------------ */

function requiredNightActors(room) {
  return NIGHT_ROLES
    .map(role => aliveWithRole(room, role))
    .filter(Boolean);
}

function eligibleVoters(room) {
  return alivePlayers(room).filter(p => !p.silenced);
}

function progressOf(room) {
  if (room.phase === "night") {
    const actors = requiredNightActors(room);
    return { done: actors.filter(p => p.action).length, total: actors.length };
  }
  if (room.phase === "day") {
    const voters = eligibleVoters(room);
    return { done: voters.filter(p => p.vote).length, total: voters.length };
  }
  return null;
}

function meView(room, p) {
  const info = ROLE_INFO[p.role];
  const me = {
    role: { key: p.role, ...info },
    alive: p.alive,
    silenced: p.silenced,
    action: p.action,
    vote: p.vote,
    results: p.results,
    canAct: room.phase === "night" && p.alive && NIGHT_ROLES.includes(p.role),
    blockedId: p.role === "doctor" ? room.lastDoctorTarget : null,
    teammates: [],
    mafiaPick: null
  };

  if (info.team === "mafia") {
    me.teammates = room.players
      .filter(t => t.id !== p.id && isMafiaTeam(t))
      .map(t => ({ id: t.id, name: t.name, role: ROLE_INFO[t.role].name, alive: t.alive }));

    if (p.role === "boss") {
      const mafia = room.players.find(t => t.role === "mafia");
      me.mafiaPick = mafia?.action?.targetId || null;
    }
  }
  return me;
}

function stateFor(room, viewer) {
  const ended = room.phase === "ended";
  return {
    code: room.code,
    phase: room.phase,
    night: room.night,
    hostId: room.hostId,
    youId: viewer.id,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isHost: p.id === room.hostId,
      alive: p.alive,
      silenced: p.silenced,
      connected: p.connected,
      role: ended || p.revealed ? ROLE_INFO[p.role].name : undefined
    })),
    logs: room.logs.slice(-14),
    chat: room.phase === "day" ? room.chat : [],
    winner: room.winner || null,
    progress: progressOf(room),
    me: room.phase === "lobby" ? null : meView(room, viewer)
  };
}

function updateRoom(room) {
  room.players.forEach(p => {
    if (p.socketId) io.to(p.socketId).emit("game:state", stateFor(room, p));
  });
}

function tell(socket, message) {
  socket.emit("game:notice", message);
}

/* ------------------------------------------------------------------ */
/* مراحل اللعب                                                          */
/* ------------------------------------------------------------------ */

function checkWinner(room) {
  const alive = alivePlayers(room);
  const mafia = alive.filter(isMafiaTeam).length;
  const city = alive.length - mafia;

  if (mafia === 0) {
    room.phase = "ended";
    room.winner = "city";
    room.logs.push("🏆 المدينة ربحت! تم القضاء على المافيا.");
    return true;
  }
  if (mafia >= city) {
    room.phase = "ended";
    room.winner = "mafia";
    room.logs.push("🏆 المافيا سيطرات على المدينة!");
    return true;
  }
  return false;
}

function beginNight(room) {
  room.phase = "night";
  room.night++;
  room.chat = [];
  room.players.forEach(p => {
    p.action = null;
    p.vote = null;
    p.silenced = false;
  });
  room.logs.push(`🌙 بدا الليل رقم ${room.night}.`);
  updateRoom(room);
}

function beginDay(room, message) {
  room.phase = "day";
  room.chat = [];
  room.players.forEach(p => {
    p.vote = null;
    p.action = null;
  });
  room.logs.push(message);
  updateRoom(room);
}

function privateResult(player, night, title, message) {
  player.results.push({ night, title, message });
}

function resolveNight(room) {
  if (room.phase !== "night") return;

  const boss = aliveWithRole(room, "boss");
  const mafia = aliveWithRole(room, "mafia");
  const doctor = aliveWithRole(room, "doctor");
  const guard = aliveWithRole(room, "bodyguard");
  const detective = aliveWithRole(room, "detective");
  const spy = aliveWithRole(room, "spy");

  // الزعيم هو اللي كيقرر؛ إلا ما بقاش، كيتنفذ اختيار المافيا.
  const victimId = boss?.action?.targetId || mafia?.action?.targetId;
  const victim = findPlayer(room, victimId);
  const guardTarget = guard?.action?.targetId;
  const doctorTarget = doctor?.action?.targetId;

  // الحارس كيتدخل الأول (كيموت بلاصة اللي كيحميه)، من بعد الطبيب.
  if (victim?.alive) {
    if (guard && guardTarget === victim.id) {
      guard.alive = false;
      guard.revealed = true;
      room.logs.push(`🛡️ الحارس الشخصي (${guard.name}) ضحى بحياتو وحمى لاعب من القتل.`);
    } else if (doctor && doctorTarget === victim.id) {
      room.logs.push("💉 محاولة قتل تّمنعات هاد الليلة.");
    } else {
      victim.alive = false;
      room.logs.push(`☠️ ${victim.name} مات فالليل.`);
    }
  } else {
    room.logs.push("🌙 داز الليل بلا ضحية.");
  }

  room.lastDoctorTarget = doctor ? doctorTarget || null : null;

  const kidnapped = findPlayer(room, boss?.action?.kidnappedId);
  if (kidnapped?.alive) {
    kidnapped.silenced = true;
    room.logs.push(`🤐 ${kidnapped.name} مخطوف: ما يقدرش يهضر ولا يصوت اليوم.`);
  }

  if (detective?.action?.targetId) {
    const target = findPlayer(room, detective.action.targetId);
    if (target) {
      // الزعيم كيبان مواطن للمحقق
      const result = target.role === "mafia" ? "مافيا" : "مواطن";
      privateResult(detective, room.night, "🔎 نتيجة التحقيق", `${target.name}: ${result}`);
    }
  }

  if (spy?.action?.targetId) {
    const target = findPlayer(room, spy.action.targetId);
    if (target) {
      privateResult(
        spy, room.night, "🕶️ نتيجة التجسس",
        `${target.name}: ${target.role === "boss" ? "هو زعيم المافيا!" : "ماشي زعيم المافيا"}`
      );
    }
  }

  if (checkWinner(room)) {
    updateRoom(room);
    return;
  }
  beginDay(room, "☀️ طلع النهار. ناقشو الأحداث وصوتو على المشتبه فيه.");
}

function resolveVotes(room, force = false) {
  if (room.phase !== "day") return;

  const voters = eligibleVoters(room);
  if (!force && !voters.every(p => p.vote)) return;

  const counts = {};
  voters.forEach(p => {
    if (p.vote) counts[p.vote] = (counts[p.vote] || 0) + 1;
  });

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length) {
    room.logs.push(
      "📊 الأصوات: " +
      entries.map(([id, n]) => `${findPlayer(room, id)?.name} (${n})`).join("، ")
    );
  }

  const max = entries[0]?.[1] || 0;
  const top = entries.filter(([, n]) => n === max);

  if (top.length !== 1) {
    room.logs.push("⚖️ التصويت تعادل. ما تسجن حتى واحد.");
  } else {
    const target = findPlayer(room, top[0][0]);
    if (target?.alive) {
      target.alive = false;
      target.revealed = true;
      room.logs.push(`🔒 ${target.name} تسجن. دورو هو: ${ROLE_INFO[target.role].name}.`);
    }
  }

  if (checkWinner(room)) {
    updateRoom(room);
    return;
  }
  beginNight(room);
}

/* ------------------------------------------------------------------ */
/* الجلسات / الغرف                                                      */
/* ------------------------------------------------------------------ */

function ctx(socket) {
  const room = rooms.get(socket.data.roomCode);
  const player = room?.players.find(p => p.id === socket.data.playerId);
  return { room, player };
}

function attach(socket, room, player) {
  clearTimeout(player.timer);
  clearTimeout(room.cleanup);
  player.socketId = socket.id;
  player.connected = true;
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  socket.join(room.code);
}

function scheduleCleanup(room) {
  clearTimeout(room.cleanup);
  if (room.players.some(p => p.connected)) return;
  room.cleanup = setTimeout(() => rooms.delete(room.code), EMPTY_ROOM_MS);
}

function ensureHost(room) {
  const host = findPlayer(room, room.hostId);
  if (host?.connected) return;
  const next = room.players.find(p => p.connected);
  if (next) room.hostId = next.id;
}

function removePlayer(room, player) {
  clearTimeout(player.timer);
  room.players = room.players.filter(p => p.id !== player.id);
  if (!room.players.length) {
    clearTimeout(room.cleanup);
    rooms.delete(room.code);
    return;
  }
  ensureHost(room);
  updateRoom(room);
}

function detach(socket, explicit) {
  const { room, player } = ctx(socket);
  socket.leave(socket.data.roomCode);
  socket.data.roomCode = null;
  socket.data.playerId = null;

  // إلا اللاعب رجع بسوكيت جديد قبل ما توصل disconnect ديال القديم
  if (!room || !player || player.socketId !== socket.id) return;

  player.socketId = null;
  player.connected = false;

  if (room.phase === "lobby") {
    if (explicit) {
      removePlayer(room, player);
    } else {
      player.timer = setTimeout(() => {
        if (!player.connected && room.phase === "lobby") removePlayer(room, player);
      }, LOBBY_GRACE_MS);
      ensureHost(room);
      updateRoom(room);
    }
  } else {
    // وسط اللعبة اللاعب كيبقى فبلاصتو ويقدر يرجع
    ensureHost(room);
    updateRoom(room);
  }
  scheduleCleanup(room);
}

io.on("connection", socket => {
  socket.on("room:create", (rawName, callback) => {
    const name = cleanName(rawName);
    if (!name) return callback?.({ ok: false, message: "دخل الاسم ديالك أولاً." });

    if (socket.data.roomCode) detach(socket, true);

    const room = {
      code: makeCode(),
      hostId: null,
      phase: "lobby",
      night: 0,
      players: [],
      logs: ["🏙️ مرحبا بكم فمدينة المافيا."],
      chat: [],
      winner: null,
      lastDoctorTarget: null,
      cleanup: null
    };
    const player = addPlayer(room, name);
    room.hostId = player.id;
    rooms.set(room.code, room);
    attach(socket, room, player);

    callback?.({ ok: true, token: player.token, state: stateFor(room, player) });
  });

  socket.on("room:join", (payload, callback) => {
    const code = String(payload?.code || "").trim().toUpperCase();
    const name = cleanName(payload?.name);
    const room = rooms.get(code);

    if (!name) return callback?.({ ok: false, message: "دخل الاسم ديالك." });
    if (!room) return callback?.({ ok: false, message: "كود الغرفة ما صحيحش." });
    if (room.phase !== "lobby") return callback?.({ ok: false, message: "اللعبة بدات، ما يمكنش تدخل دابا." });
    if (room.players.length >= MAX_PLAYERS) return callback?.({ ok: false, message: "الغرفة عامرة." });
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      return callback?.({ ok: false, message: "هاد الاسم مستعمل فالغرفة، اختار واحد آخر." });
    }

    if (socket.data.roomCode) detach(socket, true);

    const player = addPlayer(room, name);
    attach(socket, room, player);
    callback?.({ ok: true, token: player.token, state: stateFor(room, player) });
    updateRoom(room);
  });

  // رجوع اللاعب بعد قطع الاتصال (تحديث الصفحة، تبديل التطبيق، ضعف الشبكة...)
  socket.on("session:resume", (payload, callback) => {
    const room = rooms.get(String(payload?.code || "").toUpperCase());
    const player = room?.players.find(p => p.token === payload?.token);
    if (!room || !player) return callback?.({ ok: false });

    attach(socket, room, player);
    ensureHost(room);
    callback?.({ ok: true, state: stateFor(room, player) });
    updateRoom(room);
  });

  socket.on("game:start", callback => {
    const { room, player } = ctx(socket);
    if (!room) return callback?.({ ok: false, message: "ماشي داخل لشي غرفة." });
    if (player.id !== room.hostId) return callback?.({ ok: false, message: "غير المضيف يقدر يبدا اللعبة." });
    if (room.phase !== "lobby") return callback?.({ ok: false, message: "اللعبة بدات من قبل." });
    if (room.players.length < MIN_PLAYERS) {
      return callback?.({ ok: false, message: `خاصكم ${MIN_PLAYERS} لاعبين باش تبداو.` });
    }
    if (room.players.some(p => !p.connected)) {
      return callback?.({ ok: false, message: "كاين لاعب مقطوع عليه الاتصال، تسناو يرجع." });
    }

    const roles = shuffle(ROLES.slice(0, room.players.length));
    room.players.forEach((p, i) => {
      resetPlayerForGame(p);
      p.role = roles[i];
    });
    room.night = 0;
    room.winner = null;
    room.lastDoctorTarget = null;
    room.logs = ["🎭 توزعات الأدوار السرية. كل لاعب يشوف الدور ديالو فقط."];

    beginNight(room);
    callback?.({ ok: true });
  });

  socket.on("game:night-action", payload => {
    const { room, player } = ctx(socket);
    if (!room || room.phase !== "night" || !player?.alive) return;
    if (!NIGHT_ROLES.includes(player.role)) return;

    const target = findPlayer(room, payload?.targetId);
    if (!target?.alive) return tell(socket, "اختار لاعب حي.");

    if (target.id === player.id && player.role !== "doctor") {
      return tell(socket, "ما تقدرش تختار راسك.");
    }
    if (isMafiaTeam(player) && isMafiaTeam(target)) {
      return tell(socket, "ما تقدرش تقتل واحد من فريقك.");
    }
    if (player.role === "doctor" && room.lastDoctorTarget === target.id) {
      return tell(socket, "الطبيب ما يقدرش يعالج نفس الشخص ليلتين متتاليتين.");
    }

    let kidnappedId = null;
    if (player.role === "boss" && payload?.kidnappedId) {
      const kidnapped = findPlayer(room, payload.kidnappedId);
      if (!kidnapped?.alive || kidnapped.id === player.id) {
        return tell(socket, "اختار لاعب حي آخر للخطف.");
      }
      kidnappedId = kidnapped.id;
    }

    player.action = { targetId: target.id, kidnappedId };
    tell(socket, "تسجل الاختيار ديالك بسرية ✓");

    if (requiredNightActors(room).every(p => p.action)) resolveNight(room);
    else updateRoom(room);
  });

  socket.on("game:vote", targetId => {
    const { room, player } = ctx(socket);
    if (!room || room.phase !== "day" || !player?.alive || player.silenced) {
      return tell(socket, "ما تقدرش تصوت دابا.");
    }
    const target = findPlayer(room, targetId);
    if (!target?.alive || target.id === player.id) {
      return tell(socket, "اختار لاعب حي آخر.");
    }

    player.vote = target.id;
    tell(socket, "تسجل التصويت ديالك ✓");

    if (eligibleVoters(room).every(p => p.vote)) resolveVotes(room);
    else updateRoom(room);
  });

  socket.on("chat:send", rawText => {
    const { room, player } = ctx(socket);
    if (!room || room.phase !== "day" || !player?.alive || player.silenced) return;
    const text = typeof rawText === "string" ? rawText.trim().slice(0, 200) : "";
    if (!text) return;

    const now = Date.now();
    if (player.lastChat && now - player.lastChat < 400) return;
    player.lastChat = now;

    room.chat.push({ id: player.id, name: player.name, text });
    if (room.chat.length > 60) room.chat.shift();
    updateRoom(room);
  });

  // المضيف يقدر يكمل المرحلة إلا واحد وقف اللعب (مثلاً قطع الاتصال)
  socket.on("game:force-next", () => {
    const { room, player } = ctx(socket);
    if (!room || player?.id !== room.hostId) return;
    if (room.phase === "night") resolveNight(room);
    else if (room.phase === "day") resolveVotes(room, true);
  });

  socket.on("game:reset", callback => {
    const { room, player } = ctx(socket);
    if (!room || player?.id !== room.hostId || room.phase !== "ended") {
      return callback?.({ ok: false });
    }
    room.players = room.players.filter(p => p.connected);
    room.players.forEach(p => {
      resetPlayerForGame(p);
      p.role = null;
    });
    ensureHost(room);
    room.phase = "lobby";
    room.night = 0;
    room.winner = null;
    room.chat = [];
    room.lastDoctorTarget = null;
    room.logs = ["🏙️ لعبة جديدة. تسناو الأصدقاء."];
    callback?.({ ok: true });
    updateRoom(room);
  });

  socket.on("room:leave", () => detach(socket, true));
  socket.on("disconnect", () => detach(socket, false));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mafia Shadow Conflict running on port ${PORT}`);
  console.log(`  PC:      http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === "IPv4" && !n.internal) {
        console.log(`  Phones:  http://${n.address}:${PORT}   (نفس الواي فاي)`);
      }
    }
  }
  if (MIN_PLAYERS < MAX_PLAYERS) console.log(`  ⚠️ Mode test: MIN_PLAYERS=${MIN_PLAYERS}`);
});
