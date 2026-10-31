import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Screen, T, clock, useTheme } from '../../components/ui';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import type { Comment } from '../../lib/types';

/** Messages with the office about one job. Sends go through the offline queue, so they never get lost. */
export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useStore();
  const t = useTheme();
  const job = s.jobs.find((j) => j.id === id);
  const [items, setItems] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const list = useRef<FlatList<Comment>>(null);

  const load = useCallback(async () => {
    try { setItems(await api<Comment[]>('GET', `/driver/jobs/${id}/comments`)); } catch { setItems((v) => v ?? []); }
  }, [id]);
  useEffect(() => {
    void load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  // Messages still waiting for signal show straight away, marked as sending.
  const queued: Comment[] = s.pending
    .filter((o): o is Extract<typeof o, { type: 'comment' }> => o.type === 'comment' && o.job_id === id)
    .map((o) => ({ id: o.client_id, author_id: s.user?.id ?? '', author_name: s.user?.name ?? 'Me', body: o.body, created_at: o.at, seen_by: ['__sending'] }));
  const all = [...(items ?? []), ...queued];

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText('');
    await s.sendComment(id, body);
    setTimeout(() => void load(), 1500);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: job ? `Messages · #${job.number}` : 'Messages' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        {items === null ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>
        ) : (
          <FlatList
            ref={list}
            data={all}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
            onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={<T muted style={{ textAlign: 'center', marginTop: 40 }}>No messages yet. Ask the office anything about this job.</T>}
            renderItem={({ item }) => {
              const mine = item.author_id === s.user?.id;
              const sending = item.seen_by?.[0] === '__sending';
              return (
                <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 3 }}>
                  {!mine && <T size={13} weight="600" muted>{item.author_name}</T>}
                  <View style={{ maxWidth: '85%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: mine ? t.accent : t.card,
                    borderWidth: mine ? 0 : 1, borderColor: t.border, borderBottomRightRadius: mine ? 6 : 18, borderBottomLeftRadius: mine ? 18 : 6 }}>
                    <T size={17} color={mine ? t.accentText : t.text}>{item.body}</T>
                  </View>
                  <T size={12} muted>
                    {sending ? 'Sending when there is signal…' : clock(item.created_at)}
                    {mine && !sending && item.seen_by?.length ? ` · Seen by ${item.seen_by.join(', ')}` : ''}
                  </T>
                </View>
              );
            }}
          />
        )}
        <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.card }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message the office"
            placeholderTextColor={t.muted}
            multiline
            style={{ flex: 1, minHeight: 48, maxHeight: 120, fontSize: 17, color: t.text, backgroundColor: t.bg, borderRadius: 14, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12 }}
          />
          <Pressable onPress={() => void send()} disabled={!text.trim()} accessibilityRole="button"
            style={{ minWidth: 72, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent, opacity: text.trim() ? 1 : 0.5 }}>
            <T weight="700" color={t.accentText}>Send</T>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
