import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { cachedTargetURL, isWebVTT, matchesLanguage, rememberTargetTrack, responseText, subtitleTrack } from "../src/function/apple-tv-official-track.mjs";

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

test("validates and decodes WebVTT bodies", () => {
	const body = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello";
	assert.equal(isWebVTT(body), true);
	assert.equal(isWebVTT("WEBVTT\n\n"), false);
	assert.equal(responseText({ body: new TextEncoder().encode(body) }), body);
});

test("Loon and Surge rules match direct fragments but exclude internal and legacy requests", () => {
	const patterns = {};
	for (const template of ["loon", "surge"]) {
		const content = readFileSync(new URL(`../template/${template}.handlebars`, import.meta.url), "utf8");
		const pattern = template === "loon"
			? content.match(/^http-response (.+) requires-body=1, .*Official\.Direct\.response,/m)?.[1]
			: content.match(/^🍿️ DualSubs\.TV\+\.Official\.Direct\.response = .*pattern=(.+), requires-body=1,/m)?.[1];
		patterns[template] = pattern;
		const rule = new RegExp(pattern);
		assert.equal(rule.test(english), true);
		assert.equal(rule.test(`${english}?subtype=Official`), false);
		assert.equal(rule.test(`${english}?dualsubs_official_fetch=1`), false);
		assert.equal(rule.test("https://vod-fa-aoc.tv.apple.com/itunes-assets/id/empty-1.webvtt"), false);
		const directRule = content.match(/^.*Official\.Direct\.response.*$/m)?.[0] ?? "";
		assert.equal(pattern.includes(","), false, `${template} script patterns must not contain unescaped parameter separators`);
		if (template === "surge") {
			const argumentDeclaration = content.match(/^#!arguments = (.+)$/m)?.[1] ?? "";
			assert.deepEqual(
				[...argumentDeclaration.matchAll(/(?:^|,)([A-Za-z0-9]+):(?:"[^"]*"|true|false)/g)].map(match => match[1]),
				["Types", "PrimaryLanguage", "SecondaryLanguage", "Position", "Vendor", "ShowOnly", "LogLevel"],
			);
			const runtimeRule = directRule.replaceAll("\\{{{", "{{{");
			assert.match(runtimeRule, /Languages\[0\]="\{\{\{PrimaryLanguage\}\}\}"&Languages\[1\]="\{\{\{SecondaryLanguage\}\}\}"/);
			const selected = { Types: "Official", PrimaryLanguage: "EN", SecondaryLanguage: "ZH-HANS", Position: "Forward", Vendor: "Google", ShowOnly: "false", LogLevel: "INFO" };
			const scriptArgument = runtimeRule.match(/argument=(.+)$/)?.[1].replace(/\{\{\{([A-Za-z0-9]+)\}\}\}/g, (_, key) => selected[key]);
			const parsed = new URLSearchParams(scriptArgument);
			assert.equal(parsed.get("Languages[0]"), '"EN"');
			assert.equal(parsed.get("Languages[1]"), '"ZH-HANS"');
		} else assert.match(directRule, /argument=\{\{\{scriptParams\}\}\}/);
	}
	assert.equal(patterns.loon, patterns.surge, "Loon and Surge direct subtitle rules must stay in sync");
});
