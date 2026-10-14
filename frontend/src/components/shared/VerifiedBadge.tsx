const BADGE_BLUE = '#1d9bf0';

/**
 * X-style verified rosette: a circle with eight soft scallops, traced as a
 * smooth polygon (r = R + A·cos(8θ)) so the outline is our own geometry
 * rather than a copy of anyone's artwork.
 */
const ROSETTE_PATH = (() => {
  const LOBES = 8;
  const R = 9.6;
  const A = 1.15;
  const STEPS = 160;
  const points: string[] = [];
  for (let i = 0; i < STEPS; i++) {
    const theta = (i / STEPS) * Math.PI * 2;
    const r = R + A * Math.cos(LOBES * theta);
    points.push(`${(12 + r * Math.cos(theta)).toFixed(2)},${(12 + r * Math.sin(theta)).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
})();

interface VerifiedBadgeProps {
  size?: number;
}

/**
 * Blue verified badge shown after a user's name. Every active account is a
 * real, admin-created user, so callers show it unless the account is
 * deactivated.
 */
function VerifiedBadge({ size = 16 }: VerifiedBadgeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Verified account"
      style={{ display: 'inline-block', flexShrink: 0, verticalAlign: '-0.15em', marginLeft: 4 }}
    >
      <title>Verified account</title>
      <path d={ROSETTE_PATH} fill={BADGE_BLUE} />
      <path d="M7.6 12.3l3 3 5.8-6.2" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default VerifiedBadge;
