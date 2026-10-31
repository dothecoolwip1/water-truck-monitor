import { Box, Group, Text, ThemeIcon } from '@mantine/core';
import { IconDroplet } from '@tabler/icons-react';

export default function Brand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <Group gap={10} wrap="nowrap">
      <ThemeIcon size={size === 'lg' ? 44 : 34} radius="md" variant="gradient" gradient={{ from: 'water.7', to: 'cyan.5', deg: 135 }}>
        <IconDroplet size={size === 'lg' ? 26 : 20} stroke={2.2} />
      </ThemeIcon>
      <Box>
        <Text fw={800} size={size === 'lg' ? 'xl' : 'md'} lh={1.1}>Water Delivery</Text>
        <Text size="xs" c="dimmed" lh={1.2}>Dispatch &amp; metering</Text>
      </Box>
    </Group>
  );
}

