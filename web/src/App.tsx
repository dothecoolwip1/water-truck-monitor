import { lazy, Suspense } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ActionIcon, AppShell, Avatar, Box, Center, Group, Loader, Menu, NavLink as MNavLink, Stack, Text, Tooltip, UnstyledButton, useMantineColorScheme } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconChartBar, IconClipboardList, IconLayoutKanban, IconLogout, IconMoon, IconSun, IconTruck, IconUsers, IconDeviceDesktop,
} from '@tabler/icons-react';
import { useAuth } from './auth';
import Brand from './components/Brand';
import Login from './pages/Login';

// Each screen loads on first visit, so phones on slow connections start quickly.
const Dispatch = lazy(() => import('./pages/Dispatch'));
const Jobs = lazy(() => import('./pages/Jobs'));
const JobDetailPage = lazy(() => import('./pages/JobDetail'));
const Customers = lazy(() => import('./pages/Customers'));
const Fleet = lazy(() => import('./pages/Fleet'));
const Reports = lazy(() => import('./pages/Reports'));

const NAV = [
  { to: '/', label: 'Dispatch', icon: IconLayoutKanban },
  { to: '/jobs', label: 'Jobs', icon: IconClipboardList },
  { to: '/customers', label: 'Customers', icon: IconUsers },
  { to: '/fleet', label: 'Fleet', icon: IconTruck },
  { to: '/reports', label: 'Reports', icon: IconChartBar },
];

function UserMenu() {
  const { user, logout } = useAuth();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const initials = (user?.name ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <Menu position="bottom-end" width={220} shadow="md">
      <Menu.Target>
        <UnstyledButton aria-label="Account">
          <Avatar color="water" radius="xl" size={34}>{initials}</Avatar>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          <Text size="sm" fw={600} c="var(--mantine-color-text)">{user?.name}</Text>
          <Text size="xs" c="dimmed">{user?.email} · {user?.role}</Text>
        </Menu.Label>
        <Menu.Divider />
        <Menu.Label>Appearance</Menu.Label>
        <Group gap={6} px="sm" pb="xs">
          {([['light', IconSun], ['dark', IconMoon], ['auto', IconDeviceDesktop]] as const).map(([v, Icon]) => (
            <Tooltip key={v} label={v === 'auto' ? 'Match device' : v === 'light' ? 'Light' : 'Dark'}>
              <ActionIcon variant={colorScheme === v ? 'filled' : 'default'} onClick={() => setColorScheme(v)} aria-label={v}>
                <Icon size={16} />
              </ActionIcon>
            </Tooltip>
          ))}
        </Group>
        <Menu.Divider />
        <Menu.Item leftSection={<IconLogout size={16} />} color="red" onClick={logout}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function isActive(to: string, path: string) {
  return to === '/' ? path === '/' : path.startsWith(to);
}

export default function App() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  const desktop = useMediaQuery('(min-width: 48em)', true, { getInitialValueInEffect: false });

  if (loading) return <Center h="100%"><Loader /></Center>;
  if (!user) return <Login />;

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 232, breakpoint: 'sm', collapsed: { mobile: true } }}
      padding={0}
    >
      <AppShell.Header px="md" style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(60px + env(safe-area-inset-top))' }}>
        <Group h={60} justify="space-between" wrap="nowrap">
          <Brand />
          <UserMenu />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Stack gap={4}>
          {NAV.map((n) => (
            <MNavLink
              key={n.to}
              component={NavLink}
              to={n.to}
              label={n.label}
              leftSection={<n.icon size={20} stroke={1.8} />}
              active={isActive(n.to, pathname)}
              className="wt-navlink"
              variant="light"
            />
          ))}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main style={{ paddingTop: 'calc(60px + env(safe-area-inset-top))' }}>
        <Box className="wt-page">
          <Suspense fallback={<Center h={240}><Loader /></Center>}>
          <Routes>
            <Route path="/" element={<Dispatch />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/jobs/:id" element={<JobDetailPage />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:id" element={<Customers />} />
            <Route path="/fleet" element={<Fleet />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
          </Suspense>
        </Box>
      </AppShell.Main>

      {!desktop && (
        <nav className="wt-tabbar" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className="wt-tab" data-active={isActive(n.to, pathname) || undefined}>
              <n.icon size={24} stroke={isActive(n.to, pathname) ? 2.2 : 1.7} />
              {n.label}
            </NavLink>
          ))}
        </nav>
      )}
    </AppShell>
  );
}
