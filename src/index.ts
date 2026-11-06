import { createServer } from "http";
import express from "express";
import { Colyseus15Server } from "./colyseus15";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MyRoom } from "./rooms/MyRoom";

const app = express();
app.disable("x-powered-by");
app.get(["/", "/health"], (_req, res) => {
    res.json({ status: "ok", service: "bitaverse-multiplayer", host: "artificer" });
});
// No public Colyseus monitor: it can inspect and disconnect players.
const gameServer = new Colyseus15Server({
    transport: new WebSocketTransport({
        server: createServer(app),
        maxPayload: 4096,
        perMessageDeflate: false,
    }),
});
// Separate room types prevent avatars and coordinates leaking across maps.
gameServer.define("my_room", MyRoom);
gameServer.define("landmark_room", MyRoom);

gameServer.listen(Number(process.env.PORT || 2567), process.env.HOST || "127.0.0.1")
    .then(() => console.log("Bitaverse multiplayer ready"))
    .catch(error => {
        console.error("Bitaverse startup failed", error);
        process.exit(1);
    });
