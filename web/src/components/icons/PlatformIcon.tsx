import type { Platform } from "@fig/shared";

// Google: no source image provided, so a hand-built glyph (this is the
// well-known, widely-reproduced standard "G" mark). Meta/Amazon/Myntra: the
// user's provided images, processed offline (trimmed, centered, composited
// onto a white rounded-square badge -- see web/public/icons/) since Amazon's
// mark is black-on-transparent and would vanish against the dark sidebar
// otherwise. Google's glyph gets a matching badge wrapper so all four read
// as one consistent set rather than three "chips" and one bare icon.

function GoogleGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}

const IMAGE_ICONS: Partial<Record<Platform, string>> = {
  meta: "/icons/meta.png",
  amazon: "/icons/amazon.png",
  myntra: "/icons/myntra.png",
};

export function PlatformIcon({ platform, size = 18 }: { platform: Platform; size?: number }) {
  const badgeStyle = { width: size, height: size };
  const imageSrc = IMAGE_ICONS[platform];

  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt=""
        width={size}
        height={size}
        style={badgeStyle}
        className="rounded-[22%] object-cover"
      />
    );
  }

  return (
    <span className="flex items-center justify-center rounded-[22%] bg-white" style={badgeStyle}>
      <GoogleGlyph size={size * 0.72} />
    </span>
  );
}
