import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Box, Group, ScrollArea, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import { IconChecks, IconMessageCircle, IconSend } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { post, type Comment } from '../api';
import { useAuth } from '../auth';
import { notifyError, useApi, useInvalidate, useLive } from '../hooks';
import { ago } from '../format';
import { Person } from './ui';

/** Job chat between the office and the driver, with read receipts. */
export default function Conversation({ jobId, height = 340 }: { jobId: string; height?: number }) {
  const { user } = useAuth();
  const comments = useApi<Comment[]>(`/jobs/${jobId}/comments`, { refetchInterval: 20_000 });
  const invalidate = useInvalidate();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  useLive((e) => {
    if (e.type === 'comment' && e.jobId === jobId) void invalidate(`/jobs/${jobId}/comments`);
  });
  const list = comments.data ?? [];
  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' });
  }, [list.length]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      await post(`/jobs/${jobId}/comments`, { body });
      setText('');
      await invalidate(`/jobs/${jobId}/comments`, '/notifications');
    } catch (e) {
      notifyError(e, "Couldn't send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box>
      <ScrollArea.Autosize mah={height} viewportRef={viewport} type="auto" offsetScrollbars>
        {list.length === 0 ? (
          <Stack align="center" gap={6} py="lg" c="dimmed">
            <IconMessageCircle size={26} stroke={1.5} />
            <Text size="sm" ta="center" maw={260}>Messages here go straight to the driver's phone, and their replies come back here.</Text>
          </Stack>
        ) : (
          <Stack gap={10} py={4}>
            <AnimatePresence initial={false}>
              {list.map((c, i) => {
                const mine = c.author_id === user?.id;
                const showHead = i === 0 || list[i - 1].author_id !== c.author_id;
                const last = i === list.length - 1 || list[i + 1].author_id !== c.author_id;
                return (
                  <motion.div key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                    <Group gap={8} align="flex-end" wrap="nowrap" justify={mine ? 'flex-end' : 'flex-start'}>
                      {!mine && (last ? <Person name={c.author_name} size={26} /> : <Box w={26} />)}
                      <Box style={{ maxWidth: '82%' }}>
                        {showHead && !mine && <Text size="xs" c="dimmed" mb={2} ml={4}>{c.author_name}{c.author_role === 'driver' ? ' · driver' : ''}</Text>}
                        <div className="wt-bubble" data-mine={mine || undefined} style={{ maxWidth: '100%' }}>{c.body}</div>
                        {last && (
                          <Group gap={4} mt={3} justify={mine ? 'flex-end' : 'flex-start'} px={4}>
                            <Text size="xs" c="dimmed">{ago(c.created_at)}</Text>
                            {mine && c.seen_by.length > 0 && (
                              <Tooltip label={`Seen by ${c.seen_by.join(', ')}`}>
                                <Group gap={2} c="water"><IconChecks size={14} /><Text size="xs" c="water">Seen</Text></Group>
                              </Tooltip>
                            )}
                          </Group>
                        )}
                      </Box>
                    </Group>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </Stack>
        )}
      </ScrollArea.Autosize>
      <Group gap={8} mt="sm" align="flex-end" wrap="nowrap">
        <Textarea
          placeholder="Message the driver…"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          autosize
          minRows={1}
          maxRows={5}
          radius="xl"
          style={{ flex: 1 }}
        />
        <ActionIcon size={42} radius="xl" onClick={() => void send()} loading={busy} disabled={!text.trim()} aria-label="Send">
          <IconSend size={18} />
        </ActionIcon>
      </Group>
    </Box>
  );
}
