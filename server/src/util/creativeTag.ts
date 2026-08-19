// Meta creative-performance naming convention (user-specified):
//   $[SKU]_[IMG/VID/CRSL/GIF/UGC]_[Aesth/Price/Gift/Occ/Qlty/Featr/Lif/Exp]_
//    [POV/Demo/BeforeAfter/Testi/Unbox]_[M/F/NA]_v(n)_n(n)$
// wrapped in a pair of literal "$" inside the ad's name. As of 2026-08-16
// none of the live ad names carried the wrapper yet; confirmed live on
// 2026-08-19 that the rollout has since started, but what's actually
// shipping is just the SKU alone (e.g. "...[Wavy Floor Lamp] $FIG-05-007$"),
// not the full SKU_FORMAT_ANGLE_STYLE_GENDER_vN_nN sequence -- the
// descriptive words (Video/Image/UGC/etc.) are still free text OUTSIDE the
// wrapper today. The parser below already tolerates that (every field past
// SKU is optional); isTaggedCreative() only requires the SKU specifically,
// not the full sequence, so real ads attribute correctly against this
// partial rollout instead of everything reading as untagged until the rest
// of the fields show up.

export type CreativeFormat = "IMG" | "VID" | "CRSL" | "GIF" | "UGC";
export type CreativeAngle = "Aesth" | "Price" | "Gift" | "Occ" | "Qlty" | "Featr" | "Lif" | "Exp";
export type CreativeStyle = "POV" | "Demo" | "BeforeAfter" | "Testi" | "Unbox";
export type CreativeGender = "M" | "F" | "NA";

export interface ParsedCreativeTag {
  sku: string | null;
  format: CreativeFormat | null;
  angle: CreativeAngle | null;
  style: CreativeStyle | null;
  gender: CreativeGender | null;
  version: number | null;
  variant: number | null;
  /** The raw "$...$" contents, trimmed -- kept for a debug tooltip so an
   * only-partially-recognized tag (a typo'd field, an extra segment) is
   * still visible verbatim rather than silently dropped. Null if no
   * "$...$" wrapper was found at all. */
  raw: string | null;
}

const EMPTY_TAG: ParsedCreativeTag = {
  sku: null,
  format: null,
  angle: null,
  style: null,
  gender: null,
  version: null,
  variant: null,
  raw: null,
};

// First "$...$" pair in the name -- the wrapper is the signal that a
// structured tag is present at all; ad names may otherwise contain
// unrelated "$" free-form (e.g. a price callout) which this doesn't guard
// against, but there's no live example of that today.
const TAG_WRAPPER_PATTERN = /\$([^$]+)\$/;

// Same SKU-token shape as the SKU Attribution feature (server/src/routes/
// metaSkuAttribution.ts) -- one or more hyphen-joined alphanumeric segments
// starting "FIG-". Kept as a separate copy (not imported) since that
// module's matching is intentionally scoped to the whole ad name, while
// this one is intentionally scoped to inside the "$...$" wrapper only.
const SKU_TOKEN_PATTERN = /FIG-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/i;

const FORMAT_VALUES: Record<string, CreativeFormat> = {
  img: "IMG",
  vid: "VID",
  crsl: "CRSL",
  gif: "GIF",
  ugc: "UGC",
};
const ANGLE_VALUES: Record<string, CreativeAngle> = {
  aesth: "Aesth",
  price: "Price",
  gift: "Gift",
  occ: "Occ",
  qlty: "Qlty",
  featr: "Featr",
  lif: "Lif",
  exp: "Exp",
};
const STYLE_VALUES: Record<string, CreativeStyle> = {
  pov: "POV",
  demo: "Demo",
  beforeafter: "BeforeAfter",
  testi: "Testi",
  unbox: "Unbox",
};
const GENDER_VALUES: Record<string, CreativeGender> = { m: "M", f: "F", na: "NA" };

/** Parses one ad name's "$...$" creative tag, if present.
 *
 * Field order inside the wrapper is fixed by the spec (SKU, format, angle,
 * style, gender, v(n), n(n)), but real tagging is expected to be
 * inconsistent about which optional fields (angle/style/gender/variant) are
 * actually present -- exactly like the SKU-tag rollout before it. So this
 * doesn't require the full sequence: each underscore-delimited token is
 * tested against whichever categories haven't been filled yet, in spec
 * order, and the first match wins -- a token that doesn't fit any remaining
 * category is simply skipped rather than aborting the whole parse. That
 * lets "SKU_GIF_v1" (angle/style/gender all omitted) resolve to
 * {format: GIF, version: 1} instead of {} just because angle came up empty
 * first.
 *
 * version/variant use a prefix match (`v1`, `n2`, ...) rather than an exact
 * one, since Meta ad names commonly glue trailing free text straight onto
 * the last token with no separating underscore (e.g. "v1 - [Product] -
 * 12/08/2026") once the tag lacks its own closing wrapper -- once "$...$"
 * is universal that becomes moot, but costs nothing to tolerate now. */
export function parseCreativeTag(adName: string | null): ParsedCreativeTag {
  if (!adName) return EMPTY_TAG;
  const wrapped = adName.match(TAG_WRAPPER_PATTERN);
  if (!wrapped) return EMPTY_TAG;
  const raw = wrapped[1].trim();
  if (!raw) return { ...EMPTY_TAG, raw };

  const skuMatch = raw.match(SKU_TOKEN_PATTERN);
  const sku = skuMatch ? skuMatch[0].toUpperCase() : null;
  const rest = skuMatch ? raw.slice((skuMatch.index ?? 0) + skuMatch[0].length) : raw;

  const tokens = rest
    .replace(/^[_\s]+/, "")
    .split("_")
    .map((t) => t.trim())
    .filter(Boolean);

  let format: CreativeFormat | null = null;
  let angle: CreativeAngle | null = null;
  let style: CreativeStyle | null = null;
  let gender: CreativeGender | null = null;
  let version: number | null = null;
  let variant: number | null = null;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (format == null && FORMAT_VALUES[lower]) {
      format = FORMAT_VALUES[lower];
      continue;
    }
    if (angle == null && ANGLE_VALUES[lower]) {
      angle = ANGLE_VALUES[lower];
      continue;
    }
    if (style == null && STYLE_VALUES[lower]) {
      style = STYLE_VALUES[lower];
      continue;
    }
    if (gender == null && GENDER_VALUES[lower]) {
      gender = GENDER_VALUES[lower];
      continue;
    }
    if (version == null) {
      const m = token.match(/^v(\d+)/i);
      if (m) {
        version = Number(m[1]);
        continue;
      }
    }
    if (variant == null) {
      const m = token.match(/^n(\d+)/i);
      if (m) {
        variant = Number(m[1]);
        continue;
      }
    }
  }

  return { sku, format, angle, style, gender, version, variant, raw };
}

/** True once there's enough of the tag to attribute this ad to a product --
 * the SKU alone, not the full field sequence. Originally required
 * SKU + format (the two fields the written spec always carries), but real
 * ad names only carry the bare SKU today (confirmed live 2026-08-19) --
 * requiring format too made every real ad read as "no tag at all" despite
 * the SKU parsing out correctly. Format/angle/style/etc. are still parsed
 * and used to distinguish creatives when present (see
 * MetaCreativePerformanceSection.tsx's groupByCreative), just not required
 * for the "is this ad attributable" question this answers. */
export function isTaggedCreative(tag: ParsedCreativeTag): boolean {
  return tag.sku != null;
}
