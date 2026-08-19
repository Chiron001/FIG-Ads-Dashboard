import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCreativeTag, isTaggedCreative } from "./creativeTag";

test("parseCreativeTag: no ad name -> empty tag", () => {
  assert.deepEqual(parseCreativeTag(null), {
    sku: null,
    format: null,
    angle: null,
    style: null,
    gender: null,
    version: null,
    variant: null,
    raw: null,
  });
});

test("parseCreativeTag: no '$...$' wrapper at all -> empty tag, even though the bare text looks tag-shaped", () => {
  // Live example, verbatim -- some ads still use the pre-rollout bare
  // nomenclature with no "$" wrapper at all. Must not accidentally parse it
  // just because it superficially resembles the tag grammar.
  const tag = parseCreativeTag("❌FIG-05-007-RD_VID_Lif_Unbox_F_v1 - [Wavy Floor Lamp] - 12/08/2026_W33 [ Music Change]");
  assert.equal(tag.sku, null);
  assert.equal(tag.raw, null);
});

test("parseCreativeTag: real rollout shape -- bare $SKU$ only, no format/angle/style/gender/version at all", () => {
  // Confirmed live 2026-08-19: this is what's actually shipping today, not
  // the full SKU_FORMAT_..._vN sequence the written spec describes.
  const tag = parseCreativeTag("Video - Wavy Lamp - Wavy Edit New [Wavy Floor Lamp] $FIG-05-007$");
  assert.equal(tag.sku, "FIG-05-007");
  assert.equal(tag.format, null);
  assert.equal(tag.angle, null);
  assert.equal(tag.style, null);
  assert.equal(tag.gender, null);
  assert.equal(tag.version, null);
  assert.equal(isTaggedCreative(tag), true);
});

test("parseCreativeTag: full tag, every field present", () => {
  const tag = parseCreativeTag("Prospecting | $FIG-05-007-RD_VID_Lif_Unbox_F_v1_n2$ | Broad");
  assert.equal(tag.sku, "FIG-05-007-RD");
  assert.equal(tag.format, "VID");
  assert.equal(tag.angle, "Lif");
  assert.equal(tag.style, "Unbox");
  assert.equal(tag.gender, "F");
  assert.equal(tag.version, 1);
  assert.equal(tag.variant, 2);
  assert.equal(isTaggedCreative(tag), true);
});

test("parseCreativeTag: case-insensitive field matching, canonical casing in output", () => {
  const tag = parseCreativeTag("$fig-01-029_vid_aesth_pov_m_V1_N3$");
  assert.equal(tag.sku, "FIG-01-029");
  assert.equal(tag.format, "VID");
  assert.equal(tag.angle, "Aesth");
  assert.equal(tag.style, "POV");
  assert.equal(tag.gender, "M");
  assert.equal(tag.version, 1);
  assert.equal(tag.variant, 3);
});

test("parseCreativeTag: gender NA", () => {
  const tag = parseCreativeTag("$FIG-01-048-OR_GIF_Qlty_Demo_NA_v1$");
  assert.equal(tag.gender, "NA");
  assert.equal(tag.style, "Demo");
});

test("parseCreativeTag: BeforeAfter style (camelCase multi-word value)", () => {
  const tag = parseCreativeTag("$FIG-02-040_VID_Featr_BeforeAfter_M_v1$");
  assert.equal(tag.style, "BeforeAfter");
});

// The following 10 cases are the real, live ad names on the account today
// (pre-"$...$" rollout), each wrapped exactly as the user's upcoming rename
// will wrap them -- i.e. what these will parse to once tagged, not what
// they parse to right now (see the "no wrapper" test above for that).
test("parseCreativeTag: real name 1 -- angle/style/gender/version all present", () => {
  const tag = parseCreativeTag("❌$FIG-05-007-RD_VID_Lif_Unbox_F_v1$ - [Wavy Floor Lamp] - 12/08/2026_W33 [ Music Change]");
  assert.equal(tag.sku, "FIG-05-007-RD");
  assert.equal(tag.format, "VID");
  assert.equal(tag.angle, "Lif");
  assert.equal(tag.style, "Unbox");
  assert.equal(tag.gender, "F");
  assert.equal(tag.version, 1);
  assert.equal(tag.variant, null);
});

test("parseCreativeTag: real name 2 -- UGC/Exp/POV/M", () => {
  const tag = parseCreativeTag("$FIG-01-029_UGC_Exp_POV_M_v1$ - [Orilamp] - 12/08/2026_W33");
  assert.equal(tag.sku, "FIG-01-029");
  assert.equal(tag.format, "UGC");
  assert.equal(tag.angle, "Exp");
  assert.equal(tag.style, "POV");
  assert.equal(tag.gender, "M");
  assert.equal(tag.version, 1);
});

test("parseCreativeTag: real name 3/4 -- same SKU, different version numbers distinguish otherwise-identical tags", () => {
  const v1 = parseCreativeTag("$FIG-01-029_VID_Aesth_Unbox_M_v1$ - [Orilamp] - 12/08/2026_W33");
  const v2 = parseCreativeTag("$FIG-01-029_VID_Aesth_Unbox_M_v2$ - [Orilamp] - 12/08/2026_W33");
  assert.equal(v1.version, 1);
  assert.equal(v2.version, 2);
  assert.equal(v1.sku, v2.sku);
});

test("parseCreativeTag: real name 5 -- style/gender omitted, jumps straight from angle to version", () => {
  const tag = parseCreativeTag("$FIG-01-035-BG_GIF_Featr_v1$ - [Portable Lamps] - 12/08/2026_W33");
  assert.equal(tag.sku, "FIG-01-035-BG");
  assert.equal(tag.format, "GIF");
  assert.equal(tag.angle, "Featr");
  assert.equal(tag.style, null);
  assert.equal(tag.gender, null);
  assert.equal(tag.version, 1);
});

test("parseCreativeTag: real name 6 -- only format + version, everything else omitted", () => {
  const tag = parseCreativeTag("$FIG-01-044_GIF_v1$ - [Portable Lamps] - 12/08/2026_W33");
  assert.equal(tag.sku, "FIG-01-044");
  assert.equal(tag.format, "GIF");
  assert.equal(tag.angle, null);
  assert.equal(tag.style, null);
  assert.equal(tag.gender, null);
  assert.equal(tag.version, 1);
  assert.equal(isTaggedCreative(tag), true); // sku + format is enough to count as tagged
});

test("parseCreativeTag: real name 7 -- every field present including NA gender", () => {
  const tag = parseCreativeTag("$FIG-01-048-OR_GIF_Qlty_Demo_NA_v1$ [Orilamp ] - 12/08/2026_W33");
  assert.equal(tag.sku, "FIG-01-048-OR");
  assert.equal(tag.format, "GIF");
  assert.equal(tag.angle, "Qlty");
  assert.equal(tag.style, "Demo");
  assert.equal(tag.gender, "NA");
  assert.equal(tag.version, 1);
});

test("parseCreativeTag: real name 10 -- SKU token preceded by free-text prefix inside the wrapper, angle omitted", () => {
  const tag = parseCreativeTag("Video - Oblong - $FIG-02-008_UGC_Unbox_F_v1$ [Oblong Pendant Lamp]");
  assert.equal(tag.sku, "FIG-02-008");
  assert.equal(tag.format, "UGC");
  assert.equal(tag.angle, null); // skipped in the name -- not misassigned
  assert.equal(tag.style, "Unbox");
  assert.equal(tag.gender, "F");
  assert.equal(tag.version, 1);
});

test("parseCreativeTag: no SKU inside the wrapper -> sku null, other fields still parsed", () => {
  const tag = parseCreativeTag("$VID_Aesth_POV_M_v1$");
  assert.equal(tag.sku, null);
  assert.equal(tag.format, "VID");
  assert.equal(isTaggedCreative(tag), false); // sku missing -> not counted as tagged
});

test("parseCreativeTag: adjacent '$$' with nothing between -> no wrapper matched (needs >=1 char inside)", () => {
  const tag = parseCreativeTag("Ad name $$ trailing");
  assert.equal(tag.raw, null);
  assert.equal(tag.sku, null);
  assert.equal(tag.format, null);
});

test("parseCreativeTag: whitespace-only wrapper -> raw empty string after trim, no fields", () => {
  const tag = parseCreativeTag("Ad name $   $ trailing");
  assert.equal(tag.raw, "");
  assert.equal(tag.sku, null);
  assert.equal(tag.format, null);
});

test("isTaggedCreative: requires only sku, not format -- real rollout ships bare $SKU$ with no format token", () => {
  assert.equal(isTaggedCreative({ sku: "FIG-1", format: null, angle: null, style: null, gender: null, version: null, variant: null, raw: "x" }), true);
  assert.equal(isTaggedCreative({ sku: null, format: "VID", angle: null, style: null, gender: null, version: null, variant: null, raw: "x" }), false);
  assert.equal(isTaggedCreative({ sku: "FIG-1", format: "VID", angle: null, style: null, gender: null, version: null, variant: null, raw: "x" }), true);
});
