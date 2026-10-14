import type { Role } from '@/types/api';

const BADGE_BLUE = '#1d9bf0';

/** Staff accounts (any role except attachee) are the ones marked as verified. */
export function isVerifiedStaff(role?: Role | null, isActive = true): boolean {
  return isActive && role !== 'ATTACHEE';
}

interface VerifiedBadgeProps {
  size?: number;
}

/** Blue scalloped check shown after a verified staff member's name. Shape adapted from Lucide's badge-check (ISC). */
function VerifiedBadge({ size = 16 }: VerifiedBadgeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Verified staff"
      style={{ display: 'inline-block', flexShrink: 0, verticalAlign: '-0.15em', marginLeft: 4 }}
    >
      <title>Verified staff</title>
      <path
        d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
        fill={BADGE_BLUE}
        stroke={BADGE_BLUE}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <path d="m8.5 12 2.3 2.3 4.7-4.8" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default VerifiedBadge;
