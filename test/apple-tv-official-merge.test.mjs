import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cachedTargetURL, cueMatchScore, hasSufficientVTTMatch, isWebVTT, matchesLanguage, rememberTargetOffset, rememberTargetTrack, responseText, selectBestVTTMatch, subtitleOffsetCandidates, subtitleTrack } from "../src/function/apple-tv-official-track.mjs";

const english = "https://vod-fa-aoc.tv.apple.com/itunes-assets/HLSAppleVideo221/v4/english-uuid/P133_A188_en_subtitles_V2-10.webvtt";
const chinese = "https://vod-fa-aoc.tv.apple.com/itunes-assets/HLSAppleVideo221/v4/chinese-uuid/P133_A188_cmn-Hans_subtitles_V2-11.webvtt";
const japanese = "https://vod-fa-svod.tv.apple.com/itunes-assets/HLSAppleVideo221/v4/japanese-uuid/P133_A188_ja-JP_subtitles_V2-10.webvtt";
const fullEnglish = "https://vod-ap1-aoc.tv.apple.com/itunes-assets/HLSAppleVideo221/v4/english-uuid/P133_A188_en_subtitles_V2-.webvtt?cc=US";
const fullChinese = "https://vod-ap1-aoc.tv.apple.com/itunes-assets/HLSAppleVideo221/v4/chinese-uuid/P133_A188_cmn-Hans_subtitles_V2-.webvtt?cc=US";

test("recognizes only direct Apple aoc/svod subtitle fragments", () => {
	assert.equal(subtitleTrack(english)?.language, "en");
	assert.equal(subtitleTrack(japanese)?.segment, "10");
	assert.equal(subtitleTrack(fullEnglish)?.segment, "");
	assert.equal(subtitleTrack(`${english}?subtype=Official`), undefined);
	assert.equal(subtitleTrack(`${english}?dualsubs_official_fetch=1`), undefined);
	assert.equal(subtitleTrack("https://s.mzstatic.com/P133_A188_en_subtitles_V2-10.webvtt"), undefined);
	assert.equal(subtitleTrack("https://vod-fa-aoc.tv.apple.com/itunes-assets/default_en_subtitles_V2-10.webvtt"), undefined);
});

test("records and reuses complete Apple subtitle-track URLs", () => {
	const cache = rememberTargetTrack(fullChinese, "ZH", ["cmn-Hans"], {});
	assert.equal(cachedTargetURL(fullEnglish, "ZH", ["en"], cache), fullChinese);
	assert.equal(cachedTargetURL(english, "ZH", ["en"], cache), undefined);
});

test("records the observed secondary path and reuses it for any selected primary", () => {
	const cache = rememberTargetTrack(chinese, "ZH", ["cmn-Hans"], {});
	assert.equal(cachedTargetURL(english, "ZH", ["en"], cache), "https://vod-fa-aoc.tv.apple.com/itunes-assets/HLSAppleVideo221/v4/chinese-uuid/P133_A188_cmn-Hans_subtitles_V2-10.webvtt");
	rememberTargetOffset(english, "ZH", ["en"], 1, cache);
	assert.match(cachedTargetURL(english, "ZH", ["en"], cache), /V2-11\.webvtt$/);
	assert.match(cachedTargetURL(japanese, "ZH", ["ja", "ja-JP"], cache), /cmn-Hans_subtitles_V2-11\.webvtt$/);
});

test("normalizes Apple language separators and keeps targets isolated", () => {
	assert.equal(matchesLanguage("zh_Hans", ["zh-Hans"]), true);
	assert.equal(matchesLanguage("cmn-Hant", ["cmn-Hans"]), false);
	const cache = rememberTargetTrack(chinese, "ZH-HANS", ["cmn-Hans"], {});
	assert.equal(cachedTargetURL(english, "ZH", ["en"], cache), undefined);
});

test("chooses the segment with the best cue alignment", () => {
	const vtt = (...times) => ({ body: times.map(timeStamp => ({ timeStamp })) });
	const primary = vtt(3_599_117, 3_605_332, 3_607_876);
	const previous = vtt(3_501_685, 3_505_332, 3_599_117);
	const aligned = vtt(3_599_117, 3_605_332, 3_607_876);
	assert.equal(cueMatchScore(primary, previous), 1);
	assert.equal(selectBestVTTMatch(primary, [
		{ offset: 0, vtt: previous },
		{ offset: 1, vtt: aligned },
	])?.offset, 1);
});

test("widens subtitle segment search only after nearby candidates fail", () => {
	assert.deepEqual(subtitleOffsetCandidates(undefined), [0, 1, -1]);
	assert.deepEqual(subtitleOffsetCandidates(undefined, true), [0, 1, -1, 2, -2, 3, -3]);
	assert.deepEqual(subtitleOffsetCandidates(2), [2]);
	assert.deepEqual(subtitleOffsetCandidates(2, true), [2, 0, 1, -1, -2, 3, -3]);
});

test("rejects one-cue boundary overlaps and accepts the aligned segment", () => {
	assert.equal(hasSufficientVTTMatch({ score: 1 }, 19), false);
	assert.equal(hasSufficientVTTMatch({ score: 19 }, 19), true);
});

test("accepts real WebVTT cues and rejects empty bodies", () => {
	const body = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello";
	assert.equal(isWebVTT(body), true);
	assert.equal(isWebVTT("WEBVTT\n\n"), false);
	assert.equal(responseText({ body: new TextEncoder().encode(body) }), body);
});

test("keeps native Loon and Surge arguments and MITM forms", () => {
	for (const platform of ["loon", "surge"]) {
		const content = readFileSync(new URL(`../template/${platform}.handlebars`, import.meta.url), "utf8");
		const directRule = content.split("\n").find(line => line.includes("Official.Direct.response"));
		const pattern = platform === "loon"
			? directRule?.match(/^http-response (.+) requires-body=1,/)?.[1]
			: directRule?.match(/pattern=(.+), requires-body=1,/)?.[1];
		assert.equal(new RegExp(pattern).test(english), true);
		assert.match(directRule, /UniversalForApple26\/dist\/AppleTV\.OfficialMerge\.response\.bundle\.js/);
		if (platform === "loon") assert.match(directRule, /argument=\{\{\{scriptParams\}\}\}$/);
		else assert.match(directRule, /argument=Types="\\\{\{\{Types\}\}\}"&Languages\[0\]="\\\{\{\{PrimaryLanguage\}\}\}"&Languages\[1\]="\\\{\{\{SecondaryLanguage\}\}\}"/);
		const mitm = content.split("\n").find(line => line.startsWith("hostname ="));
		assert.match(mitm, /(^|, )vod-\*\.tv\.apple\.com(,|$)/);
		assert.doesNotMatch(mitm, /(^|, )\*\.tv\.apple\.com(,|$)/);
		assert.doesNotMatch(mitm, /s\.mzstatic\.com/);
	}
	const loon = readFileSync(new URL("../template/loon.handlebars", import.meta.url), "utf8");
	const surge = readFileSync(new URL("../template/surge.handlebars", import.meta.url), "utf8");
	const fullRule = surge.split("\n").find(line => line.includes("Official.Direct.Full.response"));
	const fullPattern = fullRule?.match(/pattern=(.+), requires-body=1,/)?.[1];
	assert.equal(new RegExp(fullPattern).test(fullEnglish), true);
	assert.match(loon, /^\[Argument\]\n\{\{\{arguments\}\}\}$/m);
	assert.match(surge, /^#!arguments = Types:"Official,Translate",PrimaryLanguage:"AUTO",SecondaryLanguage:"ZH",/m);
	assert.match(surge, /^#!arguments-desc = Types: 字幕类型（Official=官方合并；Translate=机器翻译）/m);
});

test("generated Loon and Surge subscriptions keep their platform-specific parameters", () => {
	const plugin = readFileSync(new URL("../dist/DualSubs.Universal.plugin", import.meta.url), "utf8");
	const module = readFileSync(new URL("../dist/DualSubs.Universal.sgmodule", import.meta.url), "utf8");
	const loonRule = plugin.split("\n").find(line => line.includes("Official.Direct.response"));
	const surgeRule = module.split("\n").find(line => line.includes("Official.Direct.response"));
	assert.match(loonRule, /argument=\[\{Types\},\{Languages\[0\]\},\{Languages\[1\]\},\{Position\},\{Vendor\},\{ShowOnly\},\{LogLevel\}\]$/);
	assert.match(surgeRule, /argument=Types="\{\{\{Types\}\}\}"&Languages\[0\]="\{\{\{PrimaryLanguage\}\}\}"&Languages\[1\]="\{\{\{SecondaryLanguage\}\}\}"/);
	assert.match(plugin, /^hostname = .*vod-\*\.tv\.apple\.com/m);
	assert.match(module, /^hostname = %APPEND% .*vod-\*\.tv\.apple\.com/m);
	assert.doesNotMatch(`${plugin}\n${module}`, /s\.mzstatic\.com/);
});
