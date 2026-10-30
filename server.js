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

const root = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.static(path.join(root, "public")));
app.use("/shared", express.static(path.join(root, "shared")));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10_000 }); // small payloads only

const store = new RoomStore();
const out = createBroadcaster(io);
const flow = createGameFlow(out);
registerHandlers(io, store, flow, out);

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mafia: Shadow Conflict -> http://localhost:${PORT}`);
});
