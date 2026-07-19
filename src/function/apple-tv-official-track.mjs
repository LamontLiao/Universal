import { URL } from "@nsnanocat/url";

const SUBTITLE_FILE = /^(?<prefix>.+)_(?<language>[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)_subtitles_(?<version>V\d+)-(?<segment>\d*)\.webvtt$/;

export function subtitleTrack(requestURL) {
	const url = new URL(requestURL);
	if (!/^vod-.+-(aoc|svod)\.tv\.apple\.com$/i.test(url.hostname) || url.searchParams.has("subtype") || url.searchParams.has("dualsubs_official_fetch")) return;
	const filename = url.pathname.split("/").at(-1);
	if (/^(empty|blank|default)([-_.]|$)/i.test(filename)) return;
	const groups = filename?.match(SUBTITLE_FILE)?.groups;
	return groups ? { url, ...groups, key: `${groups.prefix}:${groups.version}` } : undefined;
}

export function responseText(response = {}) {
	const body = response.body ?? response.bodyBytes;
	if (typeof body === "string") return body;
	if (typeof ArrayBuffer === "undefined") return "";
	const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : undefined;
	return bytes ? new TextDecoder("utf-8").decode(bytes) : "";
}

export function isWebVTT(body = "") {
	return /^\s*WEBVTT(?:\s|$)/.test(body) && /\d{2}:\d{2}(?::\d{2})?\.\d{3}\s+-->/.test(body);
}

export function matchesLanguage(language = "", languages = []) {
	const normalized = language.toLowerCase().replace(/_/g, "-");
	return languages.some(item => item.toLowerCase().replace(/_/g, "-") === normalized);
}

export function rememberTargetTrack(requestURL, target, languages, cache = {}) {
	const track = subtitleTrack(requestURL);
	if (!track || !matchesLanguage(track.language, languages)) return cache;
	const path = track.url.pathname.split("/");
	path[path.length - 1] = `${track.prefix}_${track.language}_subtitles_${track.version}-${track.segment ? "{segment}" : ""}.webvtt`;
	const key = `${track.key}:${target}`;
	const url = `${track.url.origin}${path.join("/")}${track.url.search}`;
	cache[key] = { ...(cache[key]?.url === url ? cache[key] : {}), url, updatedAt: Date.now() };
	return cache;
}

export function cachedTargetURL(requestURL, target, primaryLanguages, cache = {}, segmentOffset) {
	const track = subtitleTrack(requestURL);
	if (!track || !matchesLanguage(track.language, primaryLanguages)) return;
	const entry = cache[`${track.key}:${target}`];
	if (!entry?.url || (!track.segment && entry.url.includes("{segment}")) || (track.segment && !entry.url.includes("{segment}"))) return;
	if (!track.segment) return entry.url;
	const offset = Number.isInteger(segmentOffset) ? segmentOffset : Number.isInteger(entry?.offset) ? entry.offset : 0;
	const segment = Number.parseInt(track.segment, 10) + offset;
	return entry?.url && segment >= 0 ? entry.url.replace("{segment}", String(segment)) : undefined;
}

export function rememberTargetOffset(requestURL, target, primaryLanguages, offset, cache = {}) {
	const track = subtitleTrack(requestURL);
	const key = track ? `${track.key}:${target}` : "";
	if (track && matchesLanguage(track.language, primaryLanguages) && Number.isInteger(offset) && cache[key]?.url) cache[key] = { ...cache[key], offset, updatedAt: Date.now() };
	return cache;
}

export function cueMatchScore(primaryVTT = {}, secondaryVTT = {}, tolerance = 1_000) {
	let primaryIndex = 0;
	let secondaryIndex = 0;
	let score = 0;
	const primary = primaryVTT.body ?? [];
	const secondary = secondaryVTT.body ?? [];
	while (primaryIndex < primary.length && secondaryIndex < secondary.length) {
		const primaryTime = primary[primaryIndex]?.timeStamp;
		const secondaryTime = secondary[secondaryIndex]?.timeStamp;
		if (!Number.isFinite(primaryTime)) primaryIndex++;
		else if (!Number.isFinite(secondaryTime)) secondaryIndex++;
		else if (Math.abs(primaryTime - secondaryTime) <= tolerance) {
			score++;
			primaryIndex++;
			secondaryIndex++;
		} else if (primaryTime < secondaryTime) primaryIndex++;
		else secondaryIndex++;
	}
	return score;
}

export function selectBestVTTMatch(primaryVTT = {}, candidates = [], tolerance = 1_000) {
	return candidates
		.map(candidate => ({ ...candidate, score: cueMatchScore(primaryVTT, candidate.vtt, tolerance) }))
		.sort((left, right) => right.score - left.score || Math.abs(left.offset) - Math.abs(right.offset))[0];
}

export function subtitleOffsetCandidates(storedOffset, expanded = false) {
	const initial = Number.isInteger(storedOffset) ? [storedOffset] : [0, 1, -1];
	return expanded ? initial.concat([0, 1, -1, 2, -2, 3, -3].filter(offset => !initial.includes(offset))) : initial;
}

export function hasSufficientVTTMatch(best, cueCount) {
	return (best?.score ?? 0) >= Math.max(1, Math.ceil(cueCount / 2));
}
