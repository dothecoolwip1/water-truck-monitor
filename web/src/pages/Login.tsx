import { useState, type FormEvent } from 'react';
import { Alert, Button, Center, Container, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconLock, IconMail } from '@tabler/icons-react';
import { useAuth } from '../auth';
import Brand from '../components/Brand';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Center className="wt-login-bg" p="md">
      <Container size={420} w="100%">
        <Stack gap="xl">
          <Center><Brand size="lg" /></Center>
          <Paper withBorder shadow="xl" p={{ base: 'lg', sm: 32 }} radius="xl">
            <form onSubmit={submit}>
              <Stack>
                <div>
                  <Title order={2}>Sign in</Title>
                  <Text c="dimmed" size="sm">Office and dispatch. Drivers use the phone app.</Text>
                </div>
                <TextInput label="Email" type="email" autoComplete="username" inputMode="email" leftSection={<IconMail size={18} />}
                  value={email} onChange={(e) => setEmail(e.currentTarget.value)} required autoFocus />
                <PasswordInput label="Password" autoComplete="current-password" leftSection={<IconLock size={18} />}
                  value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
                {error && <Alert color="red" icon={<IconAlertCircle size={18} />}>{error}</Alert>}
                <Button type="submit" size="md" loading={busy} fullWidth mt="xs">Sign in</Button>
              </Stack>
            </form>
          </Paper>
          <Text size="xs" c="dimmed" ta="center">Deliveries, meter readings and tank levels in one place.</Text>
        </Stack>
      </Container>
    </Center>
  );
}
