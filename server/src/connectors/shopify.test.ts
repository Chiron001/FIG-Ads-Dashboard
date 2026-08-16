import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyUtmSource } from "./shopify";

test("classifyUtmSource: null/empty -> null (unattributed, not 'other')", () => {
  assert.equal(classifyUtmSource(null), null);
  assert.equal(classifyUtmSource(""), null);
});

test("classifyUtmSource: real observed Meta values on this store (live-checked)", () => {
  for (const v of [
    "MetaAds",
    "facebook",
    "Instagram_Reels",
    "Instagram_Stories",
    "Instagram_Feed",
    "ig",
    "Facebook_Mobile_Feed",
    "Meta Ads",
    "Meta ads",
    "MetaAds-SiteLink",
    "Facebook_Right_Column",
    "Facebook_Mobile_Reels",
    "Instagram_Explore_Grid_Home",
    "Threads_Feed",
    "Facebook_Marketplace",
    "Facebook_Desktop_Feed",
    "Facebook_Stories",
    "Instagram_Search",
    "Facebook_Instream_Video",
    "fb",
    "Facebook_Notification",
  ]) {
    assert.equal(classifyUtmSource(v), "meta", `expected "${v}" -> meta`);
  }
});

test("classifyUtmSource: real observed Google values on this store (live-checked)", () => {
  assert.equal(classifyUtmSource("google"), "google");
  assert.equal(classifyUtmSource("g"), "google");
});

test("classifyUtmSource: real observed non-ad-platform values classify as 'other', not guessed", () => {
  for (const v of [
    "x",
    "kwikengage",
    "kwikengageai",
    "chatgpt.com",
    "shopmy",
    "wishlink",
    "Creator",
    "Others",
    "kwikchat",
    "kwikchat/",
    "verifast",
    "shopclips.app",
    "{{placement}}",
    "IGShopping", // catalog/shopping tag prefixed "IG" but not a real Meta Ads placement token match
    "Inmark Exports Pvt. Ltd",
    "gokiki.in",
    "an",
    "perplexity",
    "referral",
    "Conv_O",
    "Pinterest",
    "souk",
    "hazlnut",
    "canva",
    "indianbranddirectory",
    "copyToPasteBoard",
  ]) {
    assert.equal(classifyUtmSource(v), "other", `expected "${v}" -> other`);
  }
});

test("classifyUtmSource: case-insensitive", () => {
  assert.equal(classifyUtmSource("GOOGLE"), "google");
  assert.equal(classifyUtmSource("FACEBOOK"), "meta");
  assert.equal(classifyUtmSource("G"), "google");
});
