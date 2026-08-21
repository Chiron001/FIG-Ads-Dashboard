import type { ChannelBucket } from "@fig/shared";

// dataviz skill's validated 8-slot categorical palette, first 5 slots in
// their given fixed order (preserves the validated adjacent-pair CVD
// safety -- reordering would break that guarantee). Slots 4-5 (yellow,
// magenta) sit below 3:1 contrast on the light surface, so every chart
// using these ships visible text labels/legend, never color alone (the
// skill's "relief rule").
export const CHANNEL_BUCKET_COLORS: Record<ChannelBucket, string> = {
  paid: "#2a78d6", // slot 1, blue
  organic: "#eb6834", // slot 2, orange
  direct: "#1baf7a", // slot 3, aqua
  referral_email_other: "#eda100", // slot 4, yellow
  unassigned: "#e87ba4", // slot 5, magenta
};
