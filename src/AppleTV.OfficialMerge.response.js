import { Console, done, fetch, Storage } from "@nsnanocat/util";
import { URL } from "@nsnanocat/url";
import VTT from "./WebVTT/WebVTT.mjs";
import Composite from "./class/Composite.mjs";
import database from "./function/database.mjs";
import setENV from "./function/setENV.mjs";
import { cachedTargetURL, hasSufficientVTTMatch, isWebVTT, matchesLanguage, rememberTargetOffset, rememberTargetTrack, responseText, selectBestVTTMatch, subtitleOffsetCandidates, subtitleTrack } from "./function/apple-tv-official-track.mjs";

const CACHE_KEY = "@DualSubs.Universal.Caches.AppleTVOfficialTracks";

async function run(request, response) {
	const originalBody = responseText(response);
	const track = subtitleTrack(request.url);
	if (!track || !isWebVTT(originalBody)) return;
	const { Settings, Configs } = setENV("DualSubs", ["Universal", "Composite"], database);
	Console.logLevel = Settings.LogLevel;
	if (!Settings.Types.includes("Official")) return;
	const [primary, secondary] = Settings.Languages.map(language => language.toUpperCase());
	const primaryLanguages = Configs.Languages[primary] ?? [primary];
	const secondaryLanguages = Configs.Languages[secondary === "ZH" ? "ZH-HANS" : secondary] ?? [secondary];
	const cache = Storage.getItem(CACHE_KEY, {});
	if (matchesLanguage(track.language, secondaryLanguages)) {
		const previous = cache[`${track.key}:${secondary}`]?.url;
		rememberTargetTrack(request.url, secondary, secondaryLanguages, cache);
		if (cache[`${track.key}:${secondary}`]?.url !== previous) Storage.setItem(CACHE_KEY, cache);
		return;
	}
	if (!matchesLanguage(track.language, primaryLanguages)) return;

	const primaryVTT = VTT.parse(originalBody);
	if (!primaryVTT.body?.length) return;
	const headers = { ...request.headers, Accept: "text/vtt,*/*" };
	for (const header of ["Host", "host", "Content-Length", "content-length", "Range", "range", "If-Range", "if-range", "If-None-Match", "if-none-match", "If-Modified-Since", "if-modified-since"]) delete headers[header];
	const fetchSecondary = async offset => {
		const targetURL = cachedTargetURL(request.url, secondary, primaryLanguages, cache, offset);
		if (!targetURL) return;
		const internalURL = new URL(targetURL);
		internalURL.searchParams.set("dualsubs_official_fetch", "1");
		try {
			const targetResponse = await fetch({ url: internalURL.toString(), headers, timeout: 3_000 });
			const body = responseText(targetResponse);
			const status = Number(targetResponse.statusCode ?? targetResponse.status);
			if (status < 200 || status >= 300 || !isWebVTT(body)) return;
			const vtt = VTT.parse(body);
			return vtt.body?.length ? { offset, vtt } : undefined;
		} catch (error) {
			Console.debug(`Apple TV+ official subtitle candidate ${offset} failed`, error);
		}
	};

	const storedOffset = cache[`${track.key}:${secondary}`]?.offset;
	const preferredOffsets = track.segment ? subtitleOffsetCandidates(storedOffset) : [0];
	let candidates = (await Promise.all(preferredOffsets.map(fetchSecondary))).filter(Boolean);
	let best = selectBestVTTMatch(primaryVTT, candidates, Settings.Tolerance);
	if (track.segment && !hasSufficientVTTMatch(best, primaryVTT.body.length)) {
		const fallbackOffsets = subtitleOffsetCandidates(storedOffset, true).filter(offset => !preferredOffsets.includes(offset));
		candidates = candidates.concat((await Promise.all(fallbackOffsets.map(fetchSecondary))).filter(Boolean));
		best = selectBestVTTMatch(primaryVTT, candidates, Settings.Tolerance);
	}
	if (!hasSufficientVTTMatch(best, primaryVTT.body.length)) return;
	if (track.segment && best.offset !== storedOffset) {
		rememberTargetOffset(request.url, secondary, primaryLanguages, best.offset, cache);
		Storage.setItem(CACHE_KEY, cache);
	}
	response.body = VTT.stringify(new Composite(Settings).webVTT(primaryVTT, best.vtt));
	Console.info(`Apple TV+ official bilingual subtitle: ${primary} + ${secondary}, offset ${best.offset}, matched ${best.score}/${primaryVTT.body.length}`);
}

run($request, $response)
	.catch(error => Console.warn("Apple TV+ official subtitle merge failed; keeping original subtitle", error))
	.finally(() => done($response));
