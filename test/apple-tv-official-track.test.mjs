import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { cachedSimplifiedChineseURL, isWebVTT, rememberSimplifiedChinese, responseText, subtitleTrack } from "../src/function/apple-tv-official-track.mjs";

const english = "https://vod-fa-aoc.tv.apple.com/itunes-assets/HLSAppleVideo221/v4/english-uuid/P133_A188_en_subtitles_V2-10.webvtt";
const chinese = "https://vod-fa-aoc.tv.apple.com/itunes-assets/HLSAppleVideo221/v4/chinese-uuid/P133_A188_cmn-Hans_subtitles_V2-11.webvtt";

test("parses Apple TV subtitle fragments", () => {
	assert.deepEqual(subtitleTrack(english)?.language, "en");
	assert.deepEqual(subtitleTrack(english)?.segment, "10");
	assert.equal(subtitleTrack("https://example.com/empty-1.webvtt"), undefined);
});

test("learns the real simplified-Chinese directory and maps the English segment", () => {
	const cache = rememberSimplifiedChinese(chinese, {});
	assert.equal(cachedSimplifiedChineseURL(english, cache), "https://vod-fa-aoc.tv.apple.com/itunes-assets/HLSAppleVideo221/v4/chinese-uuid/P133_A188_cmn-Hans_subtitles_V2-10.webvtt");
});

test("does not replace simplified Chinese with traditional Chinese", () => {
	const cache = rememberSimplifiedChinese(chinese, {});
	rememberSimplifiedChinese(chinese.replace("cmn-Hans", "cmn-Hant"), cache);
	assert.match(cachedSimplifiedChineseURL(english, cache), /cmn-Hans/);
});

test("validates and decodes WebVTT bodies", () => {
	const body = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello";
	assert.equal(isWebVTT(body), true);
	assert.equal(isWebVTT("WEBVTT\n\n"), false);
	assert.equal(responseText({ body: new TextEncoder().encode(body) }), body);
});

test("Loon and Surge rules match direct fragments but exclude internal and legacy requests", () => {
	for (const template of ["loon", "surge"]) {
		const content = readFileSync(new URL(`../template/${template}.handlebars`, import.meta.url), "utf8");
		const pattern = template === "loon"
			? content.match(/^http-response (.+) requires-body=1, .*Official\.Direct\.response$/m)?.[1]
			: content.match(/^🍿️ DualSubs\.TV\+\.Official\.Direct\.response = .*pattern=(.+), requires-body=1,/m)?.[1];
		const rule = new RegExp(pattern);
		assert.equal(rule.test(english), true);
		assert.equal(rule.test(`${english}?subtype=Official`), false);
		assert.equal(rule.test(`${english}?dualsubs_official_fetch=1`), false);
		assert.equal(rule.test("https://vod-fa-aoc.tv.apple.com/itunes-assets/id/empty-1.webvtt"), false);
	}
});
