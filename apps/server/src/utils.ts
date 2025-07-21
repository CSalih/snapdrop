import { getConnInfo } from "hono/bun";
import type { Context } from "hono";
import type { PeerInfo } from "./peer";

export function hashCode(str: string) {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const chr = str.charCodeAt(i);
		hash = (hash << 5) - hash + chr;
		hash |= 0; // Convert to 32bit integer
	}
	return hash;
}

export function createUUID() {
	let uuid = "";

	for (let i = 0; i < 32; i++) {
		switch (i) {
			case 8:
			case 20:
				uuid += "-";
				uuid += ((Math.random() * 16) | 0).toString(16);
				break;
			case 12:
				uuid += "-";
				uuid += "4";
				break;
			case 16:
				uuid += "-";
				uuid += ((Math.random() * 4) | 8).toString(16);
				break;
			default:
				uuid += ((Math.random() * 16) | 0).toString(16);
		}
	}

	return uuid;
}

export function getIPAddress(context: Context) {
	const forwardedFor = context.req.header("x-forwarded-for");
	if (forwardedFor) {
		// FIXME: Security Vulnerability! Validate origin ip (proxy) otherwise user can set this header!
		return forwardedFor.split(/\s*,\s*/)[0];
	}

	const info = getConnInfo(context);

	// IPv4 and IPv6 use different values to refer to localhost
	if (
		info.remote.address === "::1" ||
		info.remote.address === "::ffff:127.0.0.1"
	) {
		return "127.0.0.1";
	}

	return info.remote.address;
}

export function getUserTopicId(peer: PeerInfo) {
	return peer.id;
}

export function getRoomTopicId(peer: PeerInfo) {
	return peer.ip;
}
