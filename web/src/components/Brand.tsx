import { useId } from 'react';
import { Box, Group, Text } from '@mantine/core';

const ORG = import.meta.env.VITE_ORG_NAME ?? 'Fort Good Hope';

/** The product mark: a droplet inside a rounded tile with a soft highlight. */
export function Mark({ size = 34 }: { size?: number }) {
  // Unique ids: two marks on one page (one hidden) must not share gradients, or the visible one renders blank.
  const uid = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <linearGradient id={`bg${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b8cf0" />
          <stop offset="1" stopColor="#0b4aa6" />
        </linearGradient>
        <linearGradient id={`dr${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#cfe6ff" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#bg${uid})`} />
      <path d="M20 8.5c4.6 5.6 8 10.2 8 14.4a8 8 0 0 1-16 0c0-4.2 3.4-8.8 8-14.4Z" fill={`url(#dr${uid})`} />
      <path d="M16.2 24.2a4 4 0 0 0 3.6 3.6" stroke="#2a74db" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.7" />
    </svg>
  );
}

export default function Brand({ size = 'md', dark = false, compact = false }: { size?: 'md' | 'lg'; dark?: boolean; compact?: boolean }) {
  const big = size === 'lg';
  return (
    <Group gap={10} wrap="nowrap">
      <Mark size={big ? 44 : compact ? 30 : 34} />
      <Box style={{ minWidth: 0 }}>
        <Text fw={650} size={big ? 'xl' : compact ? 'md' : 'md'} lh={1.15} c={dark ? '#fff' : undefined} style={{ letterSpacing: '-0.01em' }}>Water Delivery</Text>
        {!compact && <Text size="xs" lh={1.3} c={dark ? '#7d8a9e' : 'dimmed'}>{ORG}</Text>}
      </Box>
    </Group>
  );
}
