import { Room, Client } from "@colyseus/core";
import { MyRoomState, Player } from "./schema/MyRoomState";

export class MyRoom extends Room<MyRoomState> {
    maxClients = 100;

    onCreate(options: any) {
        console.log("MyRoom created.");
        this.setState(new MyRoomState());

        this.onMessage("updatePosition", (client, data) => {
            console.log("update received -> ");
            console.debug(JSON.stringify(data));
            const player = this.state.players.get(client.sessionId);
            if (!player) return;
            player.x = data["x"];
            player.y = data['y'];
            player.z = data["z"];
            player.rx = data["rx"];
            player.ry = data['ry'];
            player.rz = data["rz"];
            player.iduser = client.sessionId;
        });

        this.onMessage("updateAnimation", (client, data) => {
            console.log("update received -> ");
            console.debug(JSON.stringify(data));
            const player = this.state.players.get(client.sessionId);
            if (!player) return;
            player.animstate = data['animstate']
            player.iduser = client.sessionId
        });

        this.onMessage("updateName", (client, data) => {
            console.log("update received -> ");
            console.debug(JSON.stringify(data));
            const player = this.state.players.get(client.sessionId);
            if (!player) return;
            player.name = data['name']
        });

        this.onMessage("updateCharacter", (client, data) => {
            console.log("update character -> ");
            console.debug(JSON.stringify(data));
            const player = this.state.players.get(client.sessionId);
            if (!player) return;
            player.base = data['base']
            player.head = data['head']
            player.body = data['body']
            player.pants = data['pants']
        });
    }

    onJoin(client: Client, options: any) {
        console.log(client.sessionId, "joined!");

        // create Player instance
        const player = new Player();
        player.x = 0;
        player.y = 0;
        player.z = 0;
        player.rx = 0;
        player.ry = 0;
        player.rz = 0;
        player.iduser = client.sessionId;
        player.name = options.name || "Guest";
        player.animstate = "idle";
        player.base = "Female";
        player.head = "HeadFemaleBase";
        player.body = "BodyFemaleBase";
        player.pants = "PantsFemaleBase";

        // // place Player at a random position in the floor
        // const FLOOR_SIZE = 500;
        // player.x = -(FLOOR_SIZE/2) + (Math.random() * FLOOR_SIZE);//0.12696102057717676
        // player.y = -1.4955648549933782;//-1;
        // player.z = -(FLOOR_SIZE/2) + (Math.random() * FLOOR_SIZE);//0.12696102039236049

        // place player in the map of players by its sessionId
        // (client.sessionId is unique per connection!)
        this.state.players.set(client.sessionId, player);

        console.log("new player =>", player.toJSON());
    }

    onLeave(client: Client, consented: boolean) {
        this.state.players.delete(client.sessionId);
        console.log(client.sessionId, "left!");
    }

    onDispose() {
        console.log("room", this.roomId, "disposing...");
    }
}
