import type { ServerWebSocket } from "bun";

import type { PeerInfo } from "./peer";
import { getRoomTopicId, getUserTopicId } from "./utils";

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

export class SnapdropWebSocketServer {
	private wss: ServerWebSocket = null;
	private readonly rooms: Map<string, Map<string, PeerInfo>>;
	private readonly peer: PeerInfo;
	private readonly server: EventPublisher;

	public constructor(
		rooms: Map<string, Map<string, PeerInfo>>,
		peer: PeerInfo,
		server: EventPublisher,
	) {
		this.rooms = rooms;
		this.peer = peer;
		this.server = server;
	}

	public onConnectionOpen(ws: ServerWebSocket) {
		this.wss = ws;

		this._send(getUserTopicId(this.peer), {
			type: "display-name",
			message: {
				displayName: this.peer.name.displayName,
				deviceName: this.peer.name.deviceName,
			},
		});

		this._joinRoom();

		this._keepAlive();
	}

	public onMessage(eventData: string) {
		const peer = this.peer;

		let message = null;
		try {
			message = JSON.parse(eventData);
		} catch (_) {
			return; // TODO: handle malformed JSON
		}

		switch (message.type) {
			case "disconnect":
				this.onConnectionClose();
				break;
			case "pong":
				peer.lastBeat = Date.now();
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
	}

	public onConnectionClose() {
		const peer = this.peer;
		const roomByIP = this.rooms.get(peer.ip);
		if (!roomByIP || !roomByIP.get(peer.id)) {
			return;
		}
		this._cancelKeepAlive(roomByIP.get(peer.id));

		roomByIP.delete(peer.id);

		this.wss.close();

		// if room is empty, delete the room
		if (roomByIP.size <= 0) {
			this.rooms.delete(peer.ip);
			return;
		}

		// notify other peers that the pear left the room
		this._send(getRoomTopicId(peer), {
			type: "peer-left",
			peerId: peer.id,
		});
	}

	private _joinRoom() {
		const peer = this.peer;

		// if a room doesn't exist, create it
		if (!this.rooms.has(peer.ip)) {
			this.rooms.set(peer.ip, new Map());
		}

		// notify all other peers in room
		this._send(getRoomTopicId(peer), {
			type: "peer-joined",
			peer: {
				id: peer.id,
				name: peer.name,
				rtcSupported: peer.rtcSupported,
			},
		});

		const peersByIP = this.rooms.get(peer.ip);
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
	}

	private _send(topicId: string, message: EventMessage) {
		const messageJson = JSON.stringify(message);
		this.server.publish(topicId, messageJson);
	}

	private _keepAlive() {
		const peer = this.peer;
		this._cancelKeepAlive(peer);
		const timeout = 30000;
		if (!peer.lastBeat) {
			peer.lastBeat = Date.now();
		}
		if (Date.now() - peer.lastBeat > 2 * timeout) {
			this.onConnectionClose();
			return;
		}

		this._send(getUserTopicId(peer), { type: "ping" });

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
