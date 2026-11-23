import { Group, Text } from '@mantine/core';
import { useId } from 'react';

/**
 * The brand mark: a sharp-cornered uptrend arrow on a rounded tile in the primary gradient
 * (same 135° primary → primary_container as the CTA buttons). Keep it in step
 * with `public/favicon.svg`.
 */
export function BrandMark({ size = 26 }: { size?: number }) {
  // Two logos can be on screen at once (phone header and sidebar), so the gradient id must be unique.
  const gradient = `brand-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4cd6ff" />
          <stop offset="1" stopColor="#009dc1" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill={`url(#${gradient})`} />
      <path
        d="M6 23 L12.5 16.5 L16.5 20 L23.5 13"
        fill="none"
        stroke="#003543"
        strokeWidth="2.5"
        strokeLinecap="butt"
        strokeLinejoin="miter"
        strokeMiterlimit="10"
      />
      <path d="M19 9.5 H26.5 V17 Z" fill="#003543" />
    </svg>
  );
}

/** The mark with the wordmark beside it. */
export function Logo() {
  return (
    <Group gap={10} wrap="nowrap">
      <BrandMark />
      <Text className="headline" fw={800} size="lg" lts="-0.01em">
        Tallyvio
      </Text>
    </Group>
  );
}
