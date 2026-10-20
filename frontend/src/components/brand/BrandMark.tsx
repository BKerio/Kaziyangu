/**
 * The Millenium Solutions "M in a ring" mark, traced from public/logo(3).png
 * (also saved standalone as public/logo-mark.svg). Draws itself in on mount;
 * hovering a `.brand-lockup` sends the ring's gap once around the monogram.
 */
function BrandMark({ size = 44, color = '#ED1C24', title = 'Millenium Solutions' }: { size?: number; color?: string; title?: string }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="12 21 494 494" role="img" aria-label={title}>
      <g fill="none" stroke={color} strokeLinejoin="miter" strokeMiterlimit={10}>
        <path className="bm-ring" d="M319.4 488.3 A228.5 228.5 0 1 1 373 465.9" strokeWidth={33} pathLength={1} />
        <path className="bm-stroke bm-left" d="M164.5 352 V173 L312.5 321 L269.5 364 L209.5 304" strokeWidth={36} pathLength={1} />
        <path className="bm-stroke bm-right" d="M372.5 440 V170 L300 242.5" strokeWidth={36} pathLength={1} />
      </g>
      <g className="bm-feet" fill={color}>
        <polygon points="146.5,340 182.5,340 182.5,348 146.5,384" />
        <polygon points="354.5,430 390.5,430 390.5,456 354.5,494" />
      </g>
    </svg>
  );
}

export default BrandMark;
