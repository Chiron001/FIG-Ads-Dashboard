import { InfoNote } from "./InfoNote";

/** Always reachable, one click away -- not a permanent full-width banner
 * anymore, but the underlying rule hasn't changed: readers must never
 * mistake a blended figure for an attributed one. */
export function AttributionBanner() {
  return (
    <div className="flex items-center gap-1.5 text-xs text-ink-muted">
      <InfoNote tone="warning" label="About attribution windows">
        Each platform on this page uses its own attribution window. Figures are never summed across platforms as a
        single number -- different windows would double-count. Any blended total is explicitly labeled{" "}
        <strong className="text-ink-primary">"blended, non-attributed."</strong>
      </InfoNote>
      <span>About the figures on this page</span>
    </div>
  );
}
