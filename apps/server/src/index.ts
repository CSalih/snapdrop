import { Hono } from "hono";
import { createBunWebSocket, serveStatic } from "hono/bun";
import { serve, type ServerWebSocket } from "bun";

import { SnapdropWebSocketServer } from "./server";
import { createPeer, PEER_COOKIE_NAME, type PeerInfo } from "./peer";
import { setCookie, getCookie } from "hono/cookie";
import { createUUID, getRoomTopicId, getUserTopicId } from "./utils";

const { upgradeWebSocket, websocket } = createBunWebSocket();

process.on("SIGINT", () => {
	console.info("SIGINT Received, exiting...");
	process.exit(0);
});

process.on("SIGTERM", () => {
	console.info("SIGTERM Received, exiting...");
	process.exit(0);
});

const port = process.env.PORT || 3000;
const app = new Hono();
// Start the Bun server
const server = serve({
	port,
	websocket,
	fetch: app.fetch,
});

app.use(async (c, next) => {
	let peerId = getCookie(c, PEER_COOKIE_NAME);
	if (!peerId) {
		peerId = createUUID();
		setCookie(c, PEER_COOKIE_NAME, peerId, {
			sameSite: "strict",
			secure: true,
		});
	}
	await next();
});

const rooms = new Map<string, Map<string, PeerInfo>>();
const wsHandler = upgradeWebSocket((c) => {
	const peerId = getCookie(c, PEER_COOKIE_NAME);
	if (!peerId) {
		throw new Error(
			"Peer ID not found! You need to activate cookies in your browser settings.",
		);
	}

	const peer = createPeer(c, peerId);

	const snapdropWS = new SnapdropWebSocketServer(rooms, peer, server);
	return {
		onOpen: (_event, ws) => {
			const rawWs = ws.raw as ServerWebSocket;
			// Subscribe to user events immediately
			rawWs.subscribe(getUserTopicId(peer));

			snapdropWS.onConnectionOpen(rawWs);

			// Subscribe to room after connection setup to avoid emitting peer-joined
			rawWs.subscribe(getRoomTopicId(peer));
		},
		onMessage(event) {
			if (typeof event.data !== "string") {
				console.error("Invalid message type!");
				return;
			}
			snapdropWS.onMessage(event.data);
		},
		onClose: (_event, ws) => {
			const rawWs = ws.raw as ServerWebSocket;

			snapdropWS.onConnectionClose();

			rawWs.unsubscribe(getUserTopicId(peer));
			rawWs.unsubscribe(getRoomTopicId(peer));
		},
	};
});

// Setup WebSocket routes
app.get("/server/webrtc", wsHandler);
app.get("/server/fallback", wsHandler);

app.use(
	"*",
	serveStatic({
		root: "./public",
	}),
);

console.log(`Snapdrop server is running on port ${port}`);
console.log("Server is using Hono and Bun");
