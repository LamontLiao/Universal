import { Console, done, fetch, Storage } from "@nsnanocat/util";
import { URL } from "@nsnanocat/url";
import VTT from "./WebVTT/WebVTT.mjs";
import Composite from "./class/Composite.mjs";
import database from "./function/database.mjs";
import setENV from "./function/setENV.mjs";
import { cachedTargetURL, isWebVTT, matchesLanguage, rememberTargetTrack, responseText, subtitleTrack } from "./function/apple-tv-official-track.mjs";

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

	const secondaryURL = cachedTargetURL($request.url, secondary, primaryLanguages, cache);
	if (!secondaryURL) return;
	const internalURL = new URL(secondaryURL);
	internalURL.searchParams.set("dualsubs_official_fetch", "1");
	const headers = { ...$request.headers, Accept: "text/vtt,*/*" };
	delete headers.Host;
	delete headers.host;
	delete headers["Content-Length"];
	delete headers["content-length"];
	const response = await fetch({ url: internalURL.toString(), headers, timeout: 3_000 });
	const secondaryBody = responseText(response);
	if ((response.statusCode ?? response.status) !== 200 || !isWebVTT(secondaryBody)) return;

	const primaryVTT = VTT.parse(originalBody);
	const secondaryVTT = VTT.parse(secondaryBody);
	if (!primaryVTT.body?.length || !secondaryVTT.body?.length) return;
	$response.body = VTT.stringify(new Composite(Settings).webVTT(primaryVTT, secondaryVTT));
	Console.info(`Apple TV+ official bilingual subtitle: ${primary} + ${secondary}`);
})()
	.catch(error => Console.warn("Apple TV+ official subtitle merge failed; keeping original primary subtitle", error))
	.finally(() => done($response));
