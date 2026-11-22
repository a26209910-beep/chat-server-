// Отдельный сервер ТОЛЬКО для чата (мод chat.js). Не нужен, если чат работает на основном сервере.
// Запуск: node chat-server.js   (порт берётся из переменной PORT)

const http = require("http");

const cleanUid = (s) => String(s || "").replace(/[^a-z0-9]/gi, "").slice(0, 16);

// ===================== ЧАТ С ЛЮДЬМИ =====================
// Сообщения живут только в памяти сервера (последние 100 на комнату) и пропадают при его перезапуске.
const CHAT_MAXMSG = 100, CHAT_MAXUSERS = 30, CHAT_ONLINE = 20000;
const chats = new Map();
chats.set("main", { title: "Общий чат", pub: true, perm: true, msgs: [], nextId: 1, users: new Map(), touched: Date.now() });
setInterval(() => {
  const t = Date.now();
  for (const [code, r] of chats) if (!r.perm && t - r.touched > 6 * 3600 * 1000) chats.delete(code); // пустые комнаты уходят через 6 часов
}, 60 * 1000);
const chatClean = (s, n) => String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const chatOnline = (r, now) => [...r.users].filter(([, u]) => now - u.seen < CHAT_ONLINE);

function chatApi(path, q, now) {
  const uid = cleanUid(q.get("uid"));
  if (!uid) return { error: "uid" };
  const name = chatClean(q.get("name"), 12) || "Игрок";
  const room = q.get("room") || "";

  if (path === "list") {
    const rooms = [];
    for (const [code, r] of chats) {
      if (r.perm || !r.pub) continue;
      const n = chatOnline(r, now).length;
      if (n > 0) rooms.push({ room: code, title: r.title, users: n });
    }
    rooms.sort((a, b) => b.users - a.users);
    return { rooms: rooms.slice(0, 12), main: { users: chatOnline(chats.get("main"), now).length } };
  }

  if (path === "create") {
    const title = chatClean(q.get("title"), 20) || "Комната";
    for (let i = 0; i < 20; i++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      if (chats.has(code)) continue;
      chats.set(code, { title, pub: q.get("pub") !== "0", perm: false, msgs: [], nextId: 1, users: new Map(), touched: now });
      return { room: code };
    }
    return { error: "busy" };
  }

  const r = chats.get(room);
  if (!r) return { error: "nf" };
  r.touched = now;
  const touch = () => {
    let u = r.users.get(uid);
    if (!u) { u = { name, seen: now, last: 0 }; r.users.set(uid, u); }
    u.name = name; u.seen = now;
    return u;
  };

  switch (path) {
    case "join": {
      for (const [k, u] of r.users) if (now - u.seen > 5 * 60 * 1000) r.users.delete(k);
      if (!r.users.has(uid) && chatOnline(r, now).length >= CHAT_MAXUSERS) return { error: "full" };
      touch();
      return { ok: true, title: r.title };
    }
    case "send": {
      const u = touch();
      if (now - u.last < 1000) return { error: "slow" };       // не чаще раза в секунду
      const t = chatClean(q.get("t"), 200);
      if (!t) return { error: "empty" };
      if (/https?:|www\.|\.(com|ru|net|org|io|me|ly)\b/i.test(t)) return { error: "links" }; // без ссылок
      u.last = now;
      r.msgs.push({ id: r.nextId++, uid, name: u.name, t, ts: now });
      if (r.msgs.length > CHAT_MAXMSG) r.msgs.shift();
      return { ok: true };
    }
    case "poll": {
      touch();
      let since = Number(q.get("since")) || 0, reset = false;
      if (since >= r.nextId) { since = 0; reset = true; }       // сервер перезапускался: начинаем историю заново
      const msgs = since === 0 ? r.msgs.slice(-30) : r.msgs.filter((m) => m.id > since);
      return {
        msgs, reset, title: r.title,
        users: chatOnline(r, now).map(([id, u]) => ({ uid: id, name: u.name })).slice(0, 40),
      };
    }
    case "leave":
      r.users.delete(uid);
      return { ok: true };
  }
  return { error: "unknown" };
}
// ========================================================

function send(res, obj) {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname.startsWith("/chat/")) return send(res, chatApi(u.pathname.slice(6), u.searchParams, Date.now()));
  return send(res, { ok: true, service: "chat-server" }); // проверка «жив ли сервер»
}).listen(process.env.PORT || 3000); 
