import { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "http";
import { Client, getBearerToken, matchMaker, Protocol, Room, Server } from "@colyseus/core";
import { encode } from "@colyseus/schema";
import { decode as decodeBounded } from "@msgpack/msgpack";

// Pinned 0.15 compatibility boundary: do not let untrusted type lengths reach
// the legacy schema decoder, or echo an arbitrary type in a WS close reason.
export function useOwnMessageHandlers(room: Room): void {
    const legacy = room as unknown as {
        onMessageHandlers: Record<string, unknown>;
        _onMessage: (client: Client, bytes: Buffer) => void;
    };
    const registry = legacy.onMessageHandlers;
    Object.setPrototypeOf(registry, null);
    const receive = legacy._onMessage.bind(room);
    let prefixes: Uint8Array[];
    legacy._onMessage = (client, bytes) => {
        const reject = () => client.leave(4002, "Invalid message");
        try {
            if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 4096) return reject();
            const code = bytes[0];
            if (code === Protocol.JOIN_ROOM || code === Protocol.LEAVE_ROOM) {
                if (bytes.length !== 1) return reject();
            } else if (code === Protocol.ROOM_DATA || code === Protocol.ROOM_DATA_BYTES) {
                // Handlers are registered synchronously by onCreate, before any
                // client can send. Accept only their canonical schema-v2 headers.
                if (!prefixes) prefixes = Object.keys(registry).map(name => {
                    const encoded: number[] = [];
                    encode.string(encoded, name);
                    return Uint8Array.from(encoded);
                });
                const prefix = prefixes.find(expected => expected.every((value, index) => bytes[index + 1] === value));
                if (!prefix) return reject();
                const offset = 1 + prefix.length;
                if (code === Protocol.ROOM_DATA && bytes.length > offset) {
                    decodeBounded(bytes.subarray(offset), {
                        maxStrLength: 256, maxBinLength: 4096, maxArrayLength: 16,
                        maxMapLength: 16, maxExtLength: 0, keyDecoder: null,
                    });
                }
            } else return reject();
            receive(client, bytes);
        } catch {
            reject();
        }
    };
}

const MAX_MATCHMAKING_BODY_BYTES = 4096;

function readMatchmakingBody(
    req: IncomingMessage, res: ServerResponse, headers: OutgoingHttpHeaders
): Promise<Buffer | undefined> {
    return new Promise(resolve => {
        let chunks: Buffer[] = [];
        let size = 0;
        let settled = false;
        const finish = (body?: Buffer) => {
            if (settled) return;
            settled = true;
            chunks = [];
            req.off("data", onData);
            req.off("end", onEnd);
            req.off("aborted", onAbort);
            res.off("close", onResponseClose);
            resolve(body);
        };
        const onAbort = () => finish();
        const onRequestClose = () => {
            finish();
            req.off("error", onAbort);
        };
        const onResponseClose = () => {
            finish();
            req.destroy();
        };
        const tooLarge = () => {
            req.pause();
            finish();
            // Do not drain an attacker-controlled stream or destroy the socket
            // before its 413 is flushed. Node closes it after this response.
            res.writeHead(413, { ...headers, Connection: "close" });
            res.end(JSON.stringify({ error: `Matchmaking body exceeds ${MAX_MATCHMAKING_BODY_BYTES} bytes` }));
        };
        const onData = (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_MATCHMAKING_BODY_BYTES) tooLarge();
            else chunks.push(chunk);
        };
        const onEnd = () => finish(req.complete ? Buffer.concat(chunks, size) : undefined);

        // Keep the error listener until request close: an abort can emit an
        // error after "aborted", even though the read promise already settled.
        req.on("error", onAbort);
        req.once("close", onRequestClose);
        req.once("aborted", onAbort);
        res.once("close", onResponseClose);
        if (Number(req.headers["content-length"]) > MAX_MATCHMAKING_BODY_BYTES) {
            tooLarge();
        } else {
            req.on("data", onData);
            req.once("end", onEnd);
        }
    });
}

// Colyseus 0.15 installs its HTTP listener ahead of Express. Own just the POST
// reader, then use the same controller, auth context and schema-v2 response.
export class Colyseus15Server extends Server {
    protected async handleMatchMakeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        if (req.method !== "POST" || matchMaker.isGracefullyShuttingDown) {
            return super.handleMatchMakeRequest(req, res);
        }
        const controller = matchMaker.controller;
        const headers = {
            ...controller.DEFAULT_CORS_HEADERS,
            ...controller.getCorsHeaders.call(undefined, req),
            "Content-Type": "application/json",
        };
        const body = await readMatchmakingBody(req, res, headers);
        if (body === undefined || res.destroyed || req.aborted) return;

        let payload: string;
        try {
            const params: string[] = req.url.match(controller.allowedRoomNameChars) || [];
            const index = params.indexOf(controller.matchmakeRoute);
            const response = await controller.invokeMethod(
                params[index + 1], params[index + 2] || "", JSON.parse(body.toString()),
                { token: getBearerToken(req.headers.authorization), request: req }
            );
            payload = JSON.stringify(response);
        } catch (error) {
            const failure = error as Error & { code?: number };
            payload = JSON.stringify({ code: failure.code, error: failure.message });
        }
        if (!res.destroyed) {
            res.writeHead(200, headers);
            res.end(payload);
        }
    }
}
