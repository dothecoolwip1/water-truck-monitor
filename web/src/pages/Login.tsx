import { useState, type FormEvent } from 'react';
import { Alert, Box, Button, Group, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { motion } from 'motion/react';
import { IconAlertCircle, IconLock, IconMail, IconMapPin, IconReceipt2, IconTruckDelivery } from '@tabler/icons-react';
import { useAuth } from '../auth';
import Brand from '../components/Brand';

const POINTS = [
  { icon: IconTruckDelivery, title: 'Dispatch in one drag', body: 'Requests, trucks and drivers on one board, with the real houses on the map.' },
  { icon: IconMapPin, title: 'Proof at every stop', body: 'Meter readings, GPS, photos and signatures from the cab, even with no signal.' },
  { icon: IconReceipt2, title: 'Billing that checks itself', body: 'Deliveries are verified against the meter and the tank, then invoiced to QuickBooks.' },
];

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
    <Box className="wt-login">
      <Box className="wt-login-art" visibleFrom="md">
        <Stack justify="space-between" h="100%" pos="relative" style={{ zIndex: 1 }}>
          <Brand dark size="lg" />
          <Stack gap="xl" maw={460}>
            <Title order={1} c="white" fz={40} lh={1.1} style={{ letterSpacing: '-0.02em' }}>Every litre, from the fill station to the tank.</Title>
            <Stack gap="lg">
              {POINTS.map((p, i) => (
                <motion.div key={p.title} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.08, duration: 0.3 }}>
                  <Group gap="md" wrap="nowrap" align="flex-start">
                    <Box className="wt-login-point"><p.icon size={20} /></Box>
                    <div>
                      <Text fw={650} c="white">{p.title}</Text>
                      <Text size="sm" c="rgba(255,255,255,0.72)">{p.body}</Text>
                    </div>
                  </Group>
                </motion.div>
              ))}
            </Stack>
          </Stack>
          <Text size="xs" c="rgba(255,255,255,0.55)">Fort Good Hope, Northwest Territories</Text>
        </Stack>
        <svg className="wt-waves" viewBox="0 0 1200 200" preserveAspectRatio="none" aria-hidden>
          <path d="M0 120 C 200 80 400 160 600 120 S 1000 80 1200 120 V200 H0Z" fill="rgb(255 255 255 / 0.08)" />
          <path d="M0 150 C 250 110 450 190 700 150 S 1050 120 1200 150 V200 H0Z" fill="rgb(255 255 255 / 0.10)" />
        </svg>
      </Box>

      <Stack justify="center" align="center" p={{ base: 'lg', sm: 48 }} mih="100dvh">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} style={{ width: '100%', maxWidth: 380 }}>
          <Stack gap="xl">
            <Box hiddenFrom="md"><Brand size="lg" /></Box>
            <div>
              <Title order={2}>Welcome back</Title>
              <Text c="dimmed" size="sm" mt={4}>Office and dispatch sign-in. Drivers use the phone app.</Text>
            </div>
            <form onSubmit={submit}>
              <Stack>
                <TextInput label="Email" type="email" autoComplete="username" inputMode="email" leftSection={<IconMail size={18} />}
                  value={email} onChange={(e) => setEmail(e.currentTarget.value)} required autoFocus />
                <PasswordInput label="Password" autoComplete="current-password" leftSection={<IconLock size={18} />}
                  value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
                {error && <Alert color="red" icon={<IconAlertCircle size={18} />}>{error}</Alert>}
                <Button type="submit" size="md" loading={busy} fullWidth mt="xs">Sign in</Button>
              </Stack>
            </form>
            <Text size="sm" c="dimmed">Ordering water for your home? <a className="wt-link" href="/request">Request a delivery</a></Text>
          </Stack>
        </motion.div>
      </Stack>
    </Box>
  );
}
