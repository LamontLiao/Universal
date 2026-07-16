import { Console, done, fetch, Storage } from "@nsnanocat/util";
import { URL } from "@nsnanocat/url";
import VTT from "./WebVTT/WebVTT.mjs";
import Composite from "./class/Composite.mjs";
import database from "./function/database.mjs";
import setENV from "./function/setENV.mjs";
import { cachedTargetOffset, cachedTargetURL, isWebVTT, matchesLanguage, rememberTargetOffset, rememberTargetTrack, responseText, selectBestVTTMatch, subtitleTrack } from "./function/apple-tv-official-track.mjs";

const cacheKey = "@DualSubs.Universal.Caches.AppleTVOfficialTracks";
const originalBody = responseText($response);

(async () => {
	const track = subtitleTrack($request.url);
	if (!track || !isWebVTT(originalBody)) return;
	const { Settings, Configs } = setENV("DualSubs", ["Universal", "Composite"], database);
	const [primary, secondary] = Settings.Languages;
	const primaryLanguages = Configs.Languages[primary] ?? [primary];
	const secondaryLanguages = Configs.Languages[secondary === "ZH" ? "ZH-HANS" : secondary] ?? [secondary];
	const cache = Storage.getItem(cacheKey, {});
	if (matchesLanguage(track.language, secondaryLanguages)) {
		const key = `${track.key}:${secondary}`;
		const previousURL = cache[key]?.url;
		const updated = rememberTargetTrack($request.url, secondary, secondaryLanguages, cache);
		if (updated[key]?.url !== previousURL) Storage.setItem(cacheKey, updated);
		return;
	}

	const primaryVTT = VTT.parse(originalBody);
	if (!primaryVTT.body?.length) return;
	const headers = { ...$request.headers, Accept: "text/vtt,*/*" };
	delete headers.Host;
	delete headers.host;
	delete headers["Content-Length"];
	delete headers["content-length"];
	const fetchSecondary = async offset => {
		const secondaryURL = cachedTargetURL($request.url, secondary, primaryLanguages, cache, offset);
		if (!secondaryURL) return undefined;
		const internalURL = new URL(secondaryURL);
		internalURL.searchParams.set("dualsubs_official_fetch", "1");
		try {
			const response = await fetch({ url: internalURL.toString(), headers, timeout: 3_000 });
			const body = responseText(response);
			if ((response.statusCode ?? response.status) !== 200 || !isWebVTT(body)) return undefined;
			const vtt = VTT.parse(body);
			return vtt.body?.length ? { offset, url: secondaryURL, vtt } : undefined;
		} catch (error) {
			Console.debug(`Apple TV+ official subtitle candidate ${offset} failed`, error);
			return undefined;
		}
	};

	const tolerance = Settings.Tolerance ?? 1_000;
	const storedOffset = cachedTargetOffset($request.url, secondary, primaryLanguages, cache);
	const initialOffsets = Number.isInteger(storedOffset) ? [storedOffset] : [0, 1, -1];
	let candidates = (await Promise.all(initialOffsets.map(fetchSecondary))).filter(Boolean);
	let best = selectBestVTTMatch(primaryVTT, candidates, tolerance);
	const minimumMatches = Math.max(1, Math.ceil(primaryVTT.body.length / 2));
	if (Number.isInteger(storedOffset) && (!best || best.score < minimumMatches)) {
		const fallbackOffsets = [0, 1, -1].filter(offset => offset !== storedOffset);
		candidates = candidates.concat((await Promise.all(fallbackOffsets.map(fetchSecondary))).filter(Boolean));
		best = selectBestVTTMatch(primaryVTT, candidates, tolerance);
	}
	if (!best || best.score === 0) return;
	if (best.score >= minimumMatches && best.offset !== storedOffset) {
		rememberTargetOffset($request.url, secondary, primaryLanguages, best.offset, cache);
		Storage.setItem(cacheKey, cache);
	}
	$response.body = VTT.stringify(new Composite(Settings).webVTT(primaryVTT, best.vtt));
	Console.info(`Apple TV+ official bilingual subtitle: ${primary} + ${secondary}, segment offset ${best.offset}, matched ${best.score}/${primaryVTT.body.length}`);
})()
	.catch(error => Console.warn("Apple TV+ official subtitle merge failed; keeping original primary subtitle", error))
	.finally(() => done($response));
