import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BigButton, Field, Screen, T, useTheme } from '../components/ui';
import { BUILT_IN_SERVER, server, setServer } from '../lib/config';
import { useStore } from '../lib/store';

export default function Login() {
  const s = useStore();
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [serverUrl, setServerUrl] = useState(server());

  useEffect(() => setServerUrl(server()), [s.ready]);
  if (s.user) return <Redirect href="/" />;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (serverUrl !== server()) await setServer(serverUrl);
      await s.login(email, password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 24, gap: 18, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
            <View style={{ gap: 6, marginBottom: 12 }}>
              <T size={30} weight="700" color={t.accent}>Water Delivery</T>
              <T muted>Driver sign-in</T>
            </View>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" onSubmitEditing={submit} />
            {error && <T color={t.danger}>{error}</T>}
            <BigButton title="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
            {showServer ? (
              <Field label="Server address" value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" keyboardType="url" hint={`Default: ${BUILT_IN_SERVER}`} />
            ) : (
              <Pressable onPress={() => setShowServer(true)} hitSlop={12} style={{ alignSelf: 'center', padding: 8 }}>
                <T size={14} color={t.accent}>Change server</T>
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}
