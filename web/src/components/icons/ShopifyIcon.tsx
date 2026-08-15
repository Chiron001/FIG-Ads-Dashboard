// Hand-built shopping-bag glyph in Shopify's brand green -- same approach as
// PlatformIcon's Google glyph (no source image provided, evocative but not
// a reproduction of official artwork), same white-badge wrapper so it reads
// as part of the same icon set in the sidebar.
export function ShopifyIcon({ size = 18 }: { size?: number }) {
  const badgeStyle = { width: size, height: size };
  return (
    <span className="flex items-center justify-center rounded-[22%] bg-white" style={badgeStyle}>
      <svg width={size * 0.72} height={size * 0.72} viewBox="0 0 24 24">
        <path
          fill="#95BF47"
          d="M17.5 5.5c-.2 0-2 .1-2 .1s-1.3-1.3-1.5-1.5c-.2-.2-.5-.1-.6-.1l-.8.2C12.3 3 11.5 2.3 10.4 2.4c-.3-.4-.7-.6-1-.6-2.5 0-3.7 3.1-4 4.7l-1.7.5c-.5.2-.6.2-.6.6L1.5 20l14 2.7L21 20.5S17.7 5.5 17.5 5.5zM12.4 4.3c-.4.1-.9.3-1.4.4 0-.7-.1-1.7-.4-2.4.9.2 1.4 1.1 1.8 2zM10 5c-.9.3-1.9.6-2.8.9.3-1 .9-2.9 2.1-3.4.3.7.6 1.6.7 2.5zM9 2c.1 0 .2 0 .3.1-1.1.5-2.2 1.9-2.7 4.6l-2.1.6C5 5.6 6.4 2 9 2z"
        />
        <path
          fill="#5E8E3E"
          d="M17.2 5.6s-1.8.1-2 .1c-.2-.2-1.5-1.5-1.5-1.5v18.5L21 20.5S17.7 5.6 17.5 5.6h-.3z"
        />
        <path
          fill="#FFF"
          d="M12.6 8.9l-.6 2.1s-.7-.3-1.5-.3c-1.2 0-1.3.8-1.3.9 0 .6.9.9 1.7 1.4.9.6 1.9 1.3 1.9 2.7 0 1.9-1.2 3.2-2.9 3.2-2 0-3.1-1.3-3.1-1.3l.5-1.7s1 .9 2 .9c.6 0 .9-.5.9-.9 0-.7-.7-1-1.5-1.5-.9-.6-1.9-1.4-1.9-2.6 0-1.7 1.2-3.4 3.7-3.4.9.1 1.4.4 1.4.4z"
        />
      </svg>
    </span>
  );
}
