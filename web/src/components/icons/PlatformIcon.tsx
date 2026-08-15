import type { ReactElement } from "react";
import type { Platform } from "@fig/shared";

// Simple, brand-color-accurate glyphs for quick visual scanning in the
// sidebar (especially collapsed mode) -- not a reproduction of any
// platform's official logo asset, just enough to be recognizable at a
// glance without redistributing trademarked artwork.

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

function MetaGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <path fill="#0081FB" d="M8.7 4.2C4.3 4.2 1 9.3 1 15.2c0 4.9 2.1 8.9 5.4 8.9 2.5 0 3.9-1.7 6.4-6 .8-1.3 1.6-2.8 2.3-4.1-1-1.6-2-3.1-2.9-4.3-1.7-2.3-2.9-5.5-3.5-5.5z" />
      <path fill="#0081FB" d="M23.3 4.2c-.6 0-1.8 3.2-3.5 5.5-.9 1.2-1.9 2.7-2.9 4.3.7 1.3 1.5 2.8 2.3 4.1 2.5 4.3 3.9 6 6.4 6 3.3 0 5.4-4 5.4-8.9 0-5.9-3.3-11-7.7-11z" />
    </svg>
  );
}

function AmazonGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        fill="#FF9900"
        d="M12.5 16.8c-3.3 0-6.4-.9-8.9-2.5-.3-.2-.5.2-.3.4 2.3 2.1 5.6 3.5 9.2 3.5 2.5 0 5.5-.8 7.5-2.3.3-.2 0-.6-.3-.5-2.2.9-4.6 1.4-7.2 1.4z"
      />
      <path
        fill="#FF9900"
        d="M19.9 15.4c-.2-.3-1.5-.4-2.2-.1-.2.1-.2-.1-.1-.2 1-.7 2.7-.5 2.9-.3.2.3-.1 2-1 2.8-.1.1-.3.1-.2-.1.2-.5.7-1.6.6-2.1z"
      />
      <path
        fill="#FF9900"
        d="M12 3c-3.3 0-6 2.7-6 6h1.8c0-2.3 1.9-4.2 4.2-4.2s4.2 1.9 4.2 4.2v.6l-2.5.3c-2.6.3-4.5 1.6-4.5 3.8 0 2 1.5 3.3 3.5 3.3 1.4 0 2.5-.6 3.5-1.5.2.5.5.9.9 1.3l1.5-1.4c-.3-.4-.5-.8-.5-1.7V9c0-3.3-2.4-6-5.1-6z"
      />
    </svg>
  );
}

function MyntraGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <text x="12" y="17.5" textAnchor="middle" fontSize="16" fontWeight="800" fill="#FF3F6C" fontFamily="system-ui, sans-serif">
        M
      </text>
    </svg>
  );
}

const GLYPHS: Record<Platform, (props: { size: number }) => ReactElement> = {
  google: GoogleGlyph,
  meta: MetaGlyph,
  amazon: AmazonGlyph,
  myntra: MyntraGlyph,
};

export function PlatformIcon({ platform, size = 18 }: { platform: Platform; size?: number }) {
  const Glyph = GLYPHS[platform];
  return <Glyph size={size} />;
}
