import { URL } from "@nsnanocat/url";

const subtitleFile = /^(?<prefix>.+)_(?<language>[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)?)_subtitles_(?<version>V\d+)-(?<segment>\d+)\.webvtt$/;

export function subtitleTrack(requestURL) {
	const url = new URL(requestURL);
	const match = url.pathname.split("/").at(-1)?.match(subtitleFile);
	return match?.groups ? { url, ...match.groups, key: `${match.groups.prefix}:${match.groups.version}` } : undefined;
}

export function responseText(response = {}) {
	const body = response.body ?? response.bodyBytes;
	if (typeof body === "string") return body;
	if (body instanceof ArrayBuffer) return new TextDecoder("utf-8").decode(new Uint8Array(body));
	if (ArrayBuffer.isView(body)) return new TextDecoder("utf-8").decode(body);
	return "";
}

export function isWebVTT(body = "") {
	return /^\s*WEBVTT(?:\s|$)/.test(body) && /\d{2}:\d{2}(?::\d{2})?\.\d{3}\s+-->/.test(body);
}

export function isEnglish(language = "") {
	return /^en(?:[-_]|$)/i.test(language);
}

function simplifiedPriority(language = "") {
	if (/^(?:cmn|zh|zho)[-_](?:Hans|CN|SG)$/i.test(language)) return 2;
	if (/^(?:cmn|zh|zho)$/i.test(language)) return 1;
	return 0;
}

export function rememberSimplifiedChinese(requestURL, cache = {}) {
	const track = subtitleTrack(requestURL);
	const priority = simplifiedPriority(track?.language);
	if (!track || !priority || (cache[track.key]?.priority ?? 0) > priority) return cache;
	const path = track.url.pathname.split("/");
	path[path.length - 1] = `${track.prefix}_${track.language}_subtitles_${track.version}-{segment}.webvtt`;
	cache[track.key] = { url: `${track.url.origin}${path.join("/")}${track.url.search}`, priority, updatedAt: Date.now() };
	return cache;
}

export function cachedSimplifiedChineseURL(requestURL, cache = {}) {
	const track = subtitleTrack(requestURL);
	if (!track || !isEnglish(track.language)) return undefined;
	return cache[track.key]?.url?.replace("{segment}", track.segment);
}
