import { URL } from "@nsnanocat/url";

const subtitleFile = /^(?<prefix>.+)_(?<language>[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)_subtitles_(?<version>V\d+)-(?<segment>\d+)\.webvtt$/;

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

export function matchesLanguage(language = "", languages = []) {
	return languages.some(item => item.toLowerCase() === language.toLowerCase());
}

export function rememberTargetTrack(requestURL, target, languages, cache = {}) {
	const track = subtitleTrack(requestURL);
	if (!track || !matchesLanguage(track.language, languages)) return cache;
	const path = track.url.pathname.split("/");
	path[path.length - 1] = `${track.prefix}_${track.language}_subtitles_${track.version}-{segment}.webvtt`;
	const key = `${track.key}:${target}`;
	const url = `${track.url.origin}${path.join("/")}${track.url.search}`;
	cache[key] = { ...(cache[key]?.url === url ? cache[key] : {}), url, updatedAt: Date.now() };
	return cache;
}

export function cachedTargetOffset(requestURL, target, languages, cache = {}) {
	const track = subtitleTrack(requestURL);
	if (!track || !matchesLanguage(track.language, languages)) return undefined;
	const offset = cache[`${track.key}:${target}`]?.offset;
	return Number.isInteger(offset) ? offset : undefined;
}

export function rememberTargetOffset(requestURL, target, languages, offset, cache = {}) {
	const track = subtitleTrack(requestURL);
	if (!track || !matchesLanguage(track.language, languages) || !Number.isInteger(offset)) return cache;
	const key = `${track.key}:${target}`;
	if (cache[key]?.url) cache[key] = { ...cache[key], offset, updatedAt: Date.now() };
	return cache;
}

export function cachedTargetURL(requestURL, target, languages, cache = {}, segmentOffset) {
	const track = subtitleTrack(requestURL);
	if (!track || !matchesLanguage(track.language, languages)) return undefined;
	const entry = cache[`${track.key}:${target}`];
	const offset = Number.isInteger(segmentOffset) ? segmentOffset : (Number.isInteger(entry?.offset) ? entry.offset : 0);
	const segment = Number.parseInt(track.segment, 10) + offset;
	if (!entry?.url || !Number.isInteger(segment) || segment < 0) return undefined;
	return entry.url.replace("{segment}", String(segment));
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
		if (!Number.isFinite(primaryTime)) {
			primaryIndex++;
			continue;
		}
		if (!Number.isFinite(secondaryTime)) {
			secondaryIndex++;
			continue;
		}
		if (Math.abs(primaryTime - secondaryTime) <= tolerance) {
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
