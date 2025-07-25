import type { ServerWebSocket } from "bun";

import type { PeerInfo } from "./peer";
import { getRoomTopicId, getUserTopicId } from "./utils";
import {Span, trace, metrics} from "@opentelemetry/api";

type EventMessage =
	| {
			type: "peer-joined";
			peer: Pick<PeerInfo, "id" | "name" | "rtcSupported">;
	  }
	| {
			type: "peer-left";
			peerId: string;
	  }
	| {
			type: "peers";
			peers: Pick<PeerInfo, "id" | "name" | "rtcSupported">[];
	  }
	| {
			type: "ping";
	  }
	| {
			type: "display-name";
			message: {
				displayName: string;
				deviceName: string;
			};
	  };

type EventPublisher = {
	publish: (topic: string, message: string) => void;
};

const tracer = trace.getTracer('SnapdropWebSocketServer');
const meter = metrics.getMeter('SnapdropWebSocketServer');
const activeSubscriptionsCounter = meter.createCounter('snapdrop.websocket.active-connections');

export class SnapdropWebSocketServer {
	private wss: ServerWebSocket | null = null;
	private readonly rooms: Map<string, Map<string, PeerInfo>>;
	private readonly peer: PeerInfo;
	private readonly eventPublisher: EventPublisher;

	public constructor(
		rooms: Map<string, Map<string, PeerInfo>>,
		peer: PeerInfo,
		eventPublisher: EventPublisher,
	) {
		this.peer = peer;
		this.rooms = rooms;
		this.eventPublisher = eventPublisher;
	}

	public onConnectionOpen(ws: ServerWebSocket) {
		tracer.startActiveSpan("websocket connection opened", (span: Span) => {
			this.wss = ws;

			// Subscribe to user events immediately
			this.wss.subscribe(getUserTopicId(this.peer));

			this._send(getUserTopicId(this.peer), {
				type: "display-name",
				message: {
					displayName: this.peer.name.displayName,
					deviceName: this.peer.name.deviceName,
				},
			});

			this._joinRoom();

			// Subscribe after connection setup to avoid self-emitting a peer-joined message
			this.wss.subscribe(getRoomTopicId(this.peer));

			this._keepAlive();

			span.end();
		})
		activeSubscriptionsCounter.add(1);
	}

	public onMessage(eventData: string) {
		tracer.startActiveSpan('message received', (span) => {
			const peer = this.peer;
			span.addEvent("Handle received message", {
				type: eventData,
				peerId: peer.id
			});

			let message = null;
			try {
				message = JSON.parse(eventData);
			} catch (_) {
				span.addEvent("Error while parsing message! Message may not a valid JSON.", {
					message: eventData
				});
				span.end();
				return;
			}

			switch (message.type) {
				case "disconnect":
					this.wss?.close();
					break;
				case "pong":
					peer.lastBeat = Date.now();
					span.addEvent("Update last revived timestamp", {
						timestamp: peer.lastBeat
					});
					break;
			}

			if (message.to && this.rooms.has(peer.ip)) {
				const recipientId = message.to; // TODO: sanitize
				delete message.to;
				// add sender id
				message.sender = peer.id;
				this._send(recipientId, message);
				return;
			}

			span.end()
		});
	}

	public onConnectionClose(ws: ServerWebSocket) {
		tracer.startActiveSpan('websocket connection closed', (span) => {
			const peer = this.peer;

			this._cancelKeepAlive(peer);

			ws.unsubscribe(getUserTopicId(peer));
			ws.unsubscribe(getRoomTopicId(peer));

			const peersByIP = this.rooms.get(peer.ip);
			if (!peersByIP) {
				// TODO: This should never happen, but if it does, we should log it
				span.end();
				return;
			}
			// remove peer from room
			peersByIP.delete(peer.id);

			// if the room is empty, delete the room
			if (peersByIP.size <= 0) {
				this.rooms.delete(peer.ip);
				span.end();
				return;
			}

			// notify other peers that the pear left the room
			this._send(getRoomTopicId(peer), {
				type: "peer-left",
				peerId: peer.id,
			});

			span.end();
		})
		activeSubscriptionsCounter.add(-1);
	}

	private _joinRoom() {
		tracer.startActiveSpan('join room', (span) => {
			try {
				const peer = this.peer;

				// if a room doesn't exist, create it
				if (!this.rooms.has(peer.ip)) {
					this.rooms.set(peer.ip, new Map());
				}

				const peersByIP = this.rooms.get(peer.ip);
				if (peersByIP === undefined) {
					throw new Error("peersByIP is undefined! This might be a bug.");
				}

				this._send(getUserTopicId(peer), {
					type: "peers",
					peers: Array.from(peersByIP.values()).map((peer) => ({
						id: peer.id,
						name: peer.name,
						s: "s",
						rtcSupported: peer.rtcSupported,
					})),
				});

				// add peer to room
				peersByIP.set(peer.id, peer);

				// notify all other peers in room
				this._send(getRoomTopicId(peer), {
					type: "peer-joined",
					peer: {
						id: peer.id,
						name: peer.name,
						rtcSupported: peer.rtcSupported,
					},
				});
			} finally {
				span.end();
			}
		})
	}

	private _send(topicId: string, message: EventMessage) {
		tracer.startActiveSpan('send message', (span) => {
			span.addEvent("Sending message to topic", { topicId, type: message.type });
			const messageJson = JSON.stringify(message);
			this.eventPublisher.publish(topicId, messageJson);

			span.end();
		})
	}

	private _keepAlive() {
		const peer = this.peer;
		const timeout = 30000;

		tracer.startActiveSpan('keep alive', (span) => {
			this._cancelKeepAlive(peer);
			if (!peer.lastBeat) {
				peer.lastBeat = Date.now();
			}
			if (Date.now() - peer.lastBeat > 2 * timeout) {
				span.addEvent("Peer is not responding, disconnecting", {
					peerId: peer.id,
					lastBeat: peer.lastBeat,
					currentTime: Date.now(),
					timeout
				})
				this.wss?.close();
				span.end();
				return;
			}

			this._send(getUserTopicId(peer), { type: "ping" });

			span.end();
		})

		peer.timerId = setTimeout(() => {
			this._keepAlive();
		}, timeout);
	}

	private _cancelKeepAlive(peer: PeerInfo) {
		if (peer.timerId) {
			clearTimeout(peer.timerId);
		}
	}
}
