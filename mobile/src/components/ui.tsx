import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, useColorScheme, View, type TextInputProps, type ViewStyle } from 'react-native';

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  return dark
    ? { dark, bg: '#121211', card: '#1e1e1c', border: '#3a3a37', text: '#f0efec', muted: '#a9a89f', accent: '#5aa1e6', accentText: '#0b0b0b', danger: '#ef7a72', ok: '#6cc070', warn: '#e0a526' }
    : { dark, bg: '#f2f3f1', card: '#ffffff', border: '#d9dad5', text: '#0b0b0b', muted: '#5f5e59', accent: '#1769aa', accentText: '#ffffff', danger: '#b3261e', ok: '#2e7d32', warn: '#8a5a00' };
}

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ flex: 1, backgroundColor: t.bg }, style]}>{children}</View>;
}

export function T({ children, size = 16, weight, color, muted, style, numberOfLines }: {
  children: ReactNode; size?: number; weight?: '400' | '600' | '700'; color?: string; muted?: boolean; style?: object; numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[{ fontSize: size, fontWeight: weight ?? '400', color: color ?? (muted ? t.muted : t.text) }, style]}>
      {children}
    </Text>
  );
}

/** The big blue button: the one obvious next step, sized for gloves. */
export function BigButton({ title, onPress, kind = 'primary', disabled, busy, small }: {
  title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; busy?: boolean; small?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : t.card;
  const fg = kind === 'primary' ? t.accentText : kind === 'danger' ? t.danger : t.accent;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === 'primary' ? bg : t.border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1, minHeight: small ? 48 : 64 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: small ? 17 : 20, fontWeight: '700' }}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const t = useTheme();
  const body = [styles.card, { backgroundColor: t.card, borderColor: t.border }, style];
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [...body, { opacity: pressed ? 0.85 : 1 }]}>{children}</Pressable>
  ) : (
    <View style={body}>{children}</View>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <T size={14} weight="600" muted>{label}</T>
      <TextInput
        placeholderTextColor={t.muted}
        {...props}
        style={[styles.input, { color: t.text, backgroundColor: t.card, borderColor: t.border }, props.style]}
      />
      {hint ? <T size={13} muted>{hint}</T> : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  button: { borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 4 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, minHeight: 56, fontSize: 20 },
});

export const litres = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v).toLocaleString('en-CA')} L`);
export const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '';
export const parseNum = (s: string): number | null => {
  const v = Number(s.replace(/[\s,]/g, ''));
  return s.trim() === '' || Number.isNaN(v) ? null : v;
};
