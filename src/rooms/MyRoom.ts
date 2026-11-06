import { Room, Client } from "@colyseus/core";
import { useOwnMessageHandlers } from "../colyseus15";
import { MyRoomState, Player } from "./schema/MyRoomState";

const movementFields = ["x", "y", "z", "rx", "ry", "rz"] as const;
const characterFields = ["base", "head", "body", "pants"] as const;
const validText = (value: unknown, maxLength: number): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= maxLength;

export class MyRoom extends Room<MyRoomState> {
    maxClients = 100;

    onCreate(_options: any) {
        useOwnMessageHandlers(this);
        this.setState(new MyRoomState());
        this.onMessage("updatePosition", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (!player || !data || !movementFields.every(
                key => typeof data[key] === "number" && Number.isFinite(data[key]) && Math.abs(data[key]) <= 10000
            )) return;
            for (const key of movementFields) player[key] = data[key];
        });
        this.onMessage("updateAnimation", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (player && data && validText(data.animstate, 32)) player.animstate = data.animstate;
        });
        this.onMessage("updateName", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (player && data && validText(data.name, 32)) player.name = data.name;
        });
        this.onMessage("updateCharacter", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (!player || !data || !characterFields.every(key => validText(data[key], 64))) return;
            for (const key of characterFields) player[key] = data[key];
        });
    }

    onJoin(client: Client, options: any) {
        const player = new Player();
        for (const key of movementFields) player[key] = 0;
        player.iduser = client.sessionId;
        player.name = validText(options?.name, 32) ? options.name : "Guest";
        player.animstate = "idle";
        player.base = "Female";
        player.head = "HeadFemaleBase";
        player.body = "BodyFemaleBase";
        player.pants = "PantsFemaleBase";
        this.state.players.set(client.sessionId, player);
    }

    onLeave(client: Client) {
        this.state.players.delete(client.sessionId);
    }
}
