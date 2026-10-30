// Entry point: HTTP server for the static files + Socket.IO for the game.
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

import { RoomStore } from "./server/rooms.js";
import { createBroadcaster } from "./server/broadcaster.js";
import { createGameFlow } from "./server/gameFlow.js";
import { registerHandlers } from "./server/handlers.js";
import { lanUrls } from "./server/network.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// 0.0.0.0 = accept connections from every device on the network, not only this computer.
const HOST = process.env.HOST || "0.0.0.0";

const app = express();
app.use(express.static(path.join(root, "public")));
app.use("/shared", express.static(path.join(root, "shared")));

// Addresses to share on the Wi-Fi (used by the lobby's invite link).
app.get("/api/network", (req, res) => {
  res.json({ port: PORT, urls: lanUrls(PORT) });
});

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10_000 }); // small payloads only

const store = new RoomStore();
const out = createBroadcaster(io);
const flow = createGameFlow(out);
registerHandlers(io, store, flow, out);

server.listen(PORT, HOST, () => {
  console.log("Mafia: Shadow Conflict est lancé !");
  console.log(`  Sur cet ordinateur : http://localhost:${PORT}`);
  const urls = lanUrls(PORT);
  if (urls.length) {
    console.log("  Pour les autres joueurs (même Wi-Fi) :");
    urls.forEach((url) => console.log(`    ${url}`));
  } else {
    console.log("  Aucun réseau détecté : connecte cet ordinateur au Wi-Fi pour jouer à plusieurs.");
  }
});
