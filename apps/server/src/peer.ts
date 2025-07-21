import { UAParser } from "ua-parser-js";
import { uniqueNamesGenerator, animals, colors } from "unique-names-generator";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";

import { createUUID, getIPAddress, hashCode } from "./utils";

export const PEER_COOKIE_NAME = "peerid";

export function getPeerId(context: Context) {
	const peerId = getCookie(context, PEER_COOKIE_NAME);
	if (peerId) {
		return peerId;
	}
	return createUUID();
}

export function getPeerName(context: Context, peerId: string) {
	const userAgent = context.req.header("user-agent") || "";
	const parser = new UAParser(userAgent);
	const result = parser.getResult();

	let deviceName = "";

	if (result?.os?.name) {
		deviceName = `${result.os.name.replace("Mac OS", "Mac")}`;
	}

	if (result?.device?.model) {
		deviceName += result.device.model;
	} else if (result?.browser?.name) {
		deviceName += result.browser.name;
	}

	if (!deviceName) {
		deviceName = "Unknown Device";
	}

	const displayName = uniqueNamesGenerator({
		length: 2,
		separator: " ",
		dictionaries: [colors, animals],
		style: "capital",
		seed: hashCode(peerId),
	});

	return {
		model: result.device?.model,
		os: result.os?.name,
		browser: result.browser?.name,
		type: result.device?.type,
		deviceName,
		displayName,
	};
}

export type PeerInfo = {
	id: string;
	name: {
		model: string;
		os: string;
		browser: string;
		type: string;
		deviceName: string;
		displayName: string;
	};
	rtcSupported: boolean;
	ip: string;
	lastBeat: number;
	timerId: NodeJS.Timeout | null;
};

export function createPeer(context: Context, peerId: string): PeerInfo {
	const id = peerId;
	const ip = getIPAddress(context);
	const name = getPeerName(context, id);

	return {
		id,
		ip,
		name,
		rtcSupported: context.req.url.includes("/webrtc"),
		timerId: null,
		lastBeat: 0,
	};
}
