import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { cachedTargetOffset, cachedTargetURL, cueMatchScore, isWebVTT, matchesLanguage, rememberTargetOffset, rememberTargetTrack, responseText, selectBestVTTMatch, subtitleTrack } from "../src/function/apple-tv-official-track.mjs";

const english = "https://vod-fa-aoc.tv.apple.com/itunes-assets/HLSAppleVideo221/v4/english-uuid/P133_A188_en_subtitles_V2-10.webvtt";
const chinese = "https://vod-fa-aoc.tv.apple.com/itunes-assets/HLSAppleVideo221/v4/chinese-uuid/P133_A188_cmn-Hans_subtitles_V2-11.webvtt";
const japanese = "https://vod-fa-aoc.tv.apple.com/itunes-assets/HLSAppleVideo221/v4/japanese-uuid/P133_A188_ja-JP_subtitles_V2-10.webvtt";
const german = "https://vod-fa-aoc.tv.apple.com/itunes-assets/HLSAppleVideo221/v4/german-uuid/P133_A188_de-DE_subtitles_V2-11.webvtt";

test("parses Apple TV subtitle fragments", () => {
	assert.deepEqual(subtitleTrack(english)?.language, "en");
	assert.deepEqual(subtitleTrack(english)?.segment, "10");
	assert.equal(subtitleTrack("https://example.com/empty-1.webvtt"), undefined);
});

test("maps any selected primary language to the learned secondary track", () => {
	const cache = rememberTargetTrack(german, "DE", ["de", "de-DE"], {});
	assert.equal(cachedTargetURL(japanese, "DE", ["ja", "ja-JP"], cache), "https://vod-fa-aoc.tv.apple.com/itunes-assets/HLSAppleVideo221/v4/german-uuid/P133_A188_de-DE_subtitles_V2-10.webvtt");
});

test("keeps target-language caches isolated", () => {
	const cache = rememberTargetTrack(chinese, "ZH", ["cmn-Hans"], {});
	rememberTargetTrack(german, "DE", ["de-DE"], cache);
	assert.match(cachedTargetURL(english, "ZH", ["en"], cache), /cmn-Hans/);
	assert.match(cachedTargetURL(japanese, "DE", ["ja-JP"], cache), /de-DE/);
	assert.equal(matchesLanguage("cmn-Hant", ["cmn-Hans"]), false);
});

test("caches and reuses the learned segment offset", () => {
	const cache = rememberTargetTrack(chinese, "ZH", ["cmn-Hans"], {});
	assert.match(cachedTargetURL(english, "ZH", ["en"], cache), /V2-10\.webvtt$/);
	rememberTargetOffset(english, "ZH", ["en"], 1, cache);
	assert.equal(cachedTargetOffset(english, "ZH", ["en"], cache), 1);
	assert.match(cachedTargetURL(english, "ZH", ["en"], cache), /V2-11\.webvtt$/);
	rememberTargetTrack(chinese, "ZH", ["cmn-Hans"], cache);
	assert.equal(cachedTargetOffset(english, "ZH", ["en"], cache), 1);
	rememberTargetTrack(chinese.replace("chinese-uuid", "alternate-uuid"), "ZH", ["cmn-Hans"], cache);
	assert.equal(cachedTargetOffset(english, "ZH", ["en"], cache), undefined);
});

test("selects aligned and shifted subtitle segments by cue timestamps", () => {
	const vtt = (...times) => ({ body: times.map(timeStamp => ({ timeStamp })) });
	const primary = vtt(3_599_117, 3_605_332, 3_607_876);
	const previous = vtt(3_501_685, 3_505_332, 3_599_117);
	const aligned = vtt(3_599_117, 3_605_332, 3_607_876);
	const next = vtt(3_707_394, 3_710_000);
	assert.equal(cueMatchScore(primary, previous), 1);
	assert.equal(selectBestVTTMatch(primary, [
		{ offset: 0, vtt: previous },
		{ offset: 1, vtt: aligned },
		{ offset: -1, vtt: next },
	])?.offset, 1);
	assert.equal(selectBestVTTMatch(primary, [
		{ offset: 0, vtt: aligned },
		{ offset: 1, vtt: next },
		{ offset: -1, vtt: previous },
	])?.offset, 0);
	assert.equal(selectBestVTTMatch(primary, [
		{ offset: 0, vtt: next },
		{ offset: 1, vtt: previous },
		{ offset: -1, vtt: aligned },
	])?.offset, -1);
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
			? content.match(/^http-response (.+) requires-body=1, .*Official\.Direct\.response,/m)?.[1]
			: content.match(/^🍿️ DualSubs\.TV\+\.Official\.Direct\.response = .*pattern=(.+), requires-body=1,/m)?.[1];
		const rule = new RegExp(pattern);
		assert.equal(rule.test(english), true);
		assert.equal(rule.test(`${english}?subtype=Official`), false);
		assert.equal(rule.test(`${english}?dualsubs_official_fetch=1`), false);
		assert.equal(rule.test("https://vod-fa-aoc.tv.apple.com/itunes-assets/id/empty-1.webvtt"), false);
		const directRule = content.match(/^.*Official\.Direct\.response.*$/m)?.[0] ?? "";
		assert.match(directRule, /AppleTV\.OfficialMerge\.v2\.response\.bundle\.js/);
		if (template === "loon") assert.match(directRule, /argument=\{\{\{scriptParams\}\}\}/);
		else assert.ok(directRule.endsWith('argument=Types="%Types%"&Languages[0]="%PrimaryLanguage%"&Languages[1]="%SecondaryLanguage%"&Position="%Position%"&Vendor="%Vendor%"&ShowOnly="%ShowOnly%"&LogLevel="%LogLevel%"'));
	}
});

test("Surge separates module parameters and keeps percent placeholders", () => {
	const expectedArguments = "#!arguments=Types:\"Official,Translate\",PrimaryLanguage:\"AUTO\",SecondaryLanguage:\"ZH\",Position:\"Reverse\",Vendor:\"Google\",ShowOnly:false,LogLevel:\"WARN\"";
	const expectedScriptArgument = 'argument=Types="%Types%"&Languages[0]="%PrimaryLanguage%"&Languages[1]="%SecondaryLanguage%"&Position="%Position%"&Vendor="%Vendor%"&ShowOnly="%ShowOnly%"&LogLevel="%LogLevel%"';
	for (const path of ["../template/surge.handlebars", "../dist/DualSubs.Universal.sgmodule"]) {
		const content = readFileSync(new URL(path, import.meta.url), "utf8");
		assert.equal(content.split("\n").find(line => line.startsWith("#!arguments")), expectedArguments);
		assert.doesNotMatch(content, /\{\{\{(?:arguments|scriptParams|Types|Languages)/);
		const scriptLines = content.split("\n").filter(line => line.includes(", argument="));
		assert.equal(scriptLines.length, 126);
		for (const line of scriptLines) assert.ok(line.endsWith(expectedScriptArgument));
	}
});

test("Loon keeps its MITM form while Surge appends its own Apple TV suffix wildcard", () => {
	const loon = readFileSync(new URL("../template/loon.handlebars", import.meta.url), "utf8");
	const plugin = readFileSync(new URL("../dist/DualSubs.Universal.plugin", import.meta.url), "utf8");
	const surge = readFileSync(new URL("../template/surge.handlebars", import.meta.url), "utf8");
	const module = readFileSync(new URL("../dist/DualSubs.Universal.sgmodule", import.meta.url), "utf8");
	assert.match(loon, /^hostname = .*\*\.tv\.apple\.com/m);
	assert.doesNotMatch(loon, /^hostname = .*vod-\*\.tv\.apple\.com/m);
	assert.match(plugin, /^hostname = .*\*\.tv\.apple\.com/m);
	assert.doesNotMatch(plugin, /^hostname = .*vod-\*\.tv\.apple\.com/m);
	assert.match(surge, /^hostname = %APPEND% .*\*\.tv\.apple\.com/m);
	assert.doesNotMatch(surge, /^hostname = %APPEND% .*vod-\*\.tv\.apple\.com/m);
	assert.match(module, /^hostname = %APPEND% .*\*\.tv\.apple\.com/m);
	assert.doesNotMatch(module, /^hostname = %APPEND% .*vod-\*\.tv\.apple\.com/m);
	assert.doesNotMatch(surge, /s\.mzstatic\.com/);
	assert.doesNotMatch(module, /s\.mzstatic\.com/);
});
