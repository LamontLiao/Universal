import { Console, done, fetch, Storage } from "@nsnanocat/util";
import { URL } from "@nsnanocat/url";
import VTT from "./WebVTT/WebVTT.mjs";
import Composite from "./class/Composite.mjs";
import database from "./function/database.mjs";
import setENV from "./function/setENV.mjs";
import { cachedSimplifiedChineseURL, isEnglish, isWebVTT, rememberSimplifiedChinese, responseText, subtitleTrack } from "./function/apple-tv-official-track.mjs";

const cacheKey = "@DualSubs.Universal.Caches.AppleTVOfficialTracks";
const originalBody = responseText($response);

(async () => {
	const track = subtitleTrack($request.url);
	if (!track || !isWebVTT(originalBody)) return;
	const cache = Storage.getItem(cacheKey, {});
	if (!isEnglish(track.language)) {
		const previousURL = cache[track.key]?.url;
		const updated = rememberSimplifiedChinese($request.url, cache);
		if (updated[track.key]?.url !== previousURL) Storage.setItem(cacheKey, updated);
		return;
	}

	const chineseURL = cachedSimplifiedChineseURL($request.url, cache);
	if (!chineseURL) return;
	const internalURL = new URL(chineseURL);
	internalURL.searchParams.set("dualsubs_official_fetch", "1");
	const headers = { ...$request.headers, Accept: "text/vtt,*/*" };
	delete headers.Host;
	delete headers.host;
	delete headers["Content-Length"];
	delete headers["content-length"];
	const response = await fetch({ url: internalURL.toString(), headers, timeout: 3_000 });
	const chineseBody = responseText(response);
	if ((response.statusCode ?? response.status) !== 200 || !isWebVTT(chineseBody)) return;

	const english = VTT.parse(originalBody);
	const chinese = VTT.parse(chineseBody);
	if (!english.body?.length || !chinese.body?.length) return;
	const { Settings } = setENV("DualSubs", ["Universal", "Composite"], database);
	$response.body = VTT.stringify(new Composite(Settings).webVTT(english, chinese));
	Console.info(`Apple TV+ official bilingual subtitle: ${chineseURL}`);
})()
	.catch(error => Console.warn("Apple TV+ official subtitle merge failed; keeping original English", error))
	.finally(() => done($response));
