import { ActionIcon, Box, Button, Group, Indicator, Popover, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconBell, IconMessageCircle, IconWorld, IconBellOff } from '@tabler/icons-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post, type Notification } from '../api';
import { useApi, useInvalidate, useLive } from '../hooks';
import { ago } from '../format';

export default function NotificationsBell({ dark = false }: { dark?: boolean }) {
  const data = useApi<{ unread: number; items: Notification[] }>('/notifications', { refetchInterval: 30_000 });
  const invalidate = useInvalidate();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  useLive((e) => {
    if (e.type === 'notification' || e.type === 'comment') void invalidate('/notifications');
  });
  const unread = data.data?.unread ?? 0;
  async function readAll() {
    await post('/notifications/read', {});
    void invalidate('/notifications');
  }
  async function go(n: Notification) {
    setOpen(false);
    if (!n.read_at) void post('/notifications/read', { ids: [n.id] }).then(() => invalidate('/notifications'));
    if (n.job_id) navigate(`/jobs/${n.job_id}`);
  }
  return (
    <Popover opened={open} onChange={setOpen} position="bottom-end" width={360} shadow="lg" radius="lg" withinPortal>
      <Popover.Target>
        <Indicator disabled={!unread} label={unread > 9 ? '9+' : unread} size={16} offset={6} color="red" withBorder>
          <ActionIcon variant="subtle" color={dark ? 'gray.4' : 'gray'} size={38} radius="xl" onClick={() => setOpen((o) => !o)} aria-label="Notifications"
            style={dark ? { color: '#9aa6b8' } : undefined}>
            <IconBell size={20} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Group justify="space-between" px="md" py="sm" style={{ borderBottom: '1px solid var(--wt-border)' }}>
          <Text fw={650}>Notifications</Text>
          {unread > 0 && <Button variant="subtle" size="compact-xs" onClick={() => void readAll()}>Mark all read</Button>}
        </Group>
        <ScrollArea.Autosize mah={420}>
          {(data.data?.items ?? []).length === 0 ? (
            <Stack align="center" gap={6} py="xl" c="dimmed"><IconBellOff size={24} stroke={1.5} /><Text size="sm">You're all caught up</Text></Stack>
          ) : (
            (data.data?.items ?? []).map((n) => (
              <UnstyledButton key={n.id} onClick={() => void go(n)} w="100%" px="md" py={10}
                style={{ borderBottom: '1px solid var(--wt-border)', background: n.read_at ? undefined : 'var(--wt-accent-soft)' }}>
                <Group gap={10} wrap="nowrap" align="flex-start">
                  <Box mt={2} c={n.kind === 'request' ? 'cyan.6' : 'water'}>{n.kind === 'request' ? <IconWorld size={18} /> : <IconMessageCircle size={18} />}</Box>
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" fw={n.read_at ? 500 : 650} lineClamp={1}>{n.title}</Text>
                    {n.body && <Text size="sm" c="dimmed" lineClamp={2}>{n.body}</Text>}
                    <Text size="xs" c="dimmed" mt={2}>{ago(n.created_at)}</Text>
                  </Box>
                </Group>
              </UnstyledButton>
            ))
          )}
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}
