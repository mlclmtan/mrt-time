/**
 * The app's static brand mark: a tiny dark platform screen with three amber
 * LED blocks over the line colours. No number on purpose (v2.2: the old
 * "3 min" badge read like a live countdown).
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg data-brand-mark width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false" className="shrink-0">
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#0f1316" stroke="#232a31" />
      <rect x="5" y="7" width="22" height="12" rx="2.5" fill="#161b20" stroke="#2b3138" />
      <rect x="8" y="11" width="4" height="4" rx="1" fill="#f6c343" />
      <rect x="14" y="11" width="4" height="4" rx="1" fill="#f6c343" />
      <rect x="20" y="11" width="4" height="4" rx="1" fill="#7a6224" />
      <rect x="5" y="22" width="6.5" height="3" rx="1.5" fill="#009645" />
      <rect x="12.75" y="22" width="6.5" height="3" rx="1.5" fill="#9D5B25" />
      <rect x="20.5" y="22" width="6.5" height="3" rx="1.5" fill="#9900AA" />
    </svg>
  );
}
