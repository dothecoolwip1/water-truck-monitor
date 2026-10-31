import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ActionIcon, AppShell, Box, Center, Drawer, Group, Loader, Menu, SegmentedControl, Stack, Text, UnstyledButton, useMantineColorScheme } from '@mantine/core';
import { useMediaQuery, useWindowScroll } from '@mantine/hooks';
import { Spotlight, spotlight, type SpotlightActionData } from '@mantine/spotlight';
import { motion } from 'motion/react';
import {
  IconChartBar, IconClipboardList, IconDeviceDesktop, IconDots, IconLayoutKanban, IconLogout, IconMoon, IconReceipt2, IconSearch,
  IconSettings, IconSun, IconDroplet, IconTruck, IconUsers, IconChevronRight, IconUser, IconHash,
} from '@tabler/icons-react';
import { useAuth } from './auth';
import Brand from './components/Brand';
import NotificationsBell from './components/Notifications';
import { Person } from './components/ui';
import { useApi } from './hooks';
import type { Customer, Job } from './api';
import { STATUS_LABEL, todayIso } from './format';
import Login from './pages/Login';

// Each screen loads on first visit, so phones on slow connections start quickly.
const Dispatch = lazy(() => import('./pages/Dispatch'));
const Jobs = lazy(() => import('./pages/Jobs'));
const JobDetailPage = lazy(() => import('./pages/JobDetail'));
const Customers = lazy(() => import('./pages/Customers'));
const Fleet = lazy(() => import('./pages/Fleet'));
const Reports = lazy(() => import('./pages/Reports'));
const Billing = lazy(() => import('./pages/Billing'));
const Settings = lazy(() => import('./pages/Settings'));
const Forecast = lazy(() => import('./pages/Forecast'));
const RequestPage = lazy(() => import('./pages/Resident').then((m) => ({ default: m.RequestPage })));
const TrackPage = lazy(() => import('./pages/Resident').then((m) => ({ default: m.TrackPage })));

interface NavItem { to: string; label: string; icon: ComponentType<{ size?: number; stroke?: number }>; group: string; admin?: boolean }
const NAV: NavItem[] = [
  { to: '/', label: 'Dispatch', icon: IconLayoutKanban, group: 'Operations' },
  { to: '/jobs', label: 'Jobs', icon: IconClipboardList, group: 'Operations' },
  { to: '/customers', label: 'Customers', icon: IconUsers, group: 'Operations' },
  { to: '/forecast', label: 'Running low', icon: IconDroplet, group: 'Operations' },
  { to: '/billing', label: 'Billing', icon: IconReceipt2, group: 'Money' },
  { to: '/reports', label: 'Reports', icon: IconChartBar, group: 'Money' },
  { to: '/fleet', label: 'Fleet & people', icon: IconTruck, group: 'Setup' },
  { to: '/settings', label: 'Settings', icon: IconSettings, group: 'Setup', admin: true },
];
const TABS = ['/', '/jobs', '/customers', '/billing'];

const isActive = (to: string, path: string) => (to === '/' ? path === '/' : path.startsWith(to));

function ThemeSwitch() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <SegmentedControl
      size="xs"
      fullWidth
      value={colorScheme}
      onChange={(v) => setColorScheme(v as 'light' | 'dark' | 'auto')}
      data={[
        { value: 'light', label: <Center style={{ gap: 6 }}><IconSun size={14} />Light</Center> },
        { value: 'dark', label: <Center style={{ gap: 6 }}><IconMoon size={14} />Dark</Center> },
        { value: 'auto', label: <Center style={{ gap: 6 }}><IconDeviceDesktop size={14} />Auto</Center> },
      ]}
    />
  );
}

function AccountMenu({ target }: { target: React.ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <Menu position="top-start" width={260} offset={6}>
      <Menu.Target>{target}</Menu.Target>
      <Menu.Dropdown>
        <Box px="sm" py={8}>
          <Text size="sm" fw={600}>{user?.name}</Text>
          <Text size="xs" c="dimmed">{user?.email}</Text>
        </Box>
        <Menu.Divider />
        <Box px="sm" py={6}><ThemeSwitch /></Box>
        <Menu.Divider />
        <Menu.Item leftSection={<IconLogout size={16} />} color="red" onClick={logout}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function SearchActions() {
  const navigate = useNavigate();
  const customers = useApi<Customer[]>('/customers');
  const jobs = useApi<Job[]>(`/jobs?from=${todayIso().slice(0, 8)}01&to=${todayIso()}`);
  const actions = useMemo<SpotlightActionData[]>(() => [
    ...NAV.map((n) => ({ id: `nav:${n.to}`, label: n.label, description: 'Go to page', leftSection: <n.icon size={18} />, onClick: () => navigate(n.to), group: 'Pages' })),
    ...(customers.data ?? []).map((c) => ({
      id: `c:${c.id}`, label: c.name, description: c.account_code ?? 'Customer', keywords: [c.account_code ?? '', c.phone ?? ''],
      leftSection: <IconUser size={18} />, onClick: () => navigate(`/customers/${c.id}`), group: 'Customers',
    })),
    ...(jobs.data ?? []).slice(0, 300).map((j) => ({
      id: `j:${j.id}`, label: `#${j.number} ${j.site_label}`, description: `${STATUS_LABEL[j.status]} · ${j.driver_name ?? 'Unassigned'}`,
      keywords: [String(j.number), j.customer_name], leftSection: <IconHash size={18} />, onClick: () => navigate(`/jobs/${j.id}`), group: 'Jobs this month',
    })),
  ], [customers.data, jobs.data, navigate]);
  return (
    <Spotlight
      actions={actions}
      nothingFound="Nothing matches"
      highlightQuery
      limit={12}
      shortcut={['mod + K', '/']}
      searchProps={{ leftSection: <IconSearch size={18} />, placeholder: 'Search jobs, customers, pages…' }}
      radius="lg"
      scrollable
      maxHeight={440}
    />
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  const { user } = useAuth();
  const items = NAV.filter((n) => !n.admin || user?.role === 'admin');
  const groups = [...new Set(items.map((n) => n.group))];
  return (
    <Stack gap={0} h="100%">
      <Group className="wt-sidebar-brand" justify="space-between" wrap="nowrap"><Brand dark /><NotificationsBell dark /></Group>
      <button className="wt-search-btn" onClick={() => spotlight.open()}>
        <IconSearch size={15} /> Search <span className="wt-kbd">⌘K</span>
      </button>
      <Box style={{ flex: 1, overflowY: 'auto' }}>
        {groups.map((g) => (
          <Box key={g}>
            <div className="wt-sidenav-group">{g}</div>
            {items.filter((n) => n.group === g).map((n) => (
              <NavLink key={n.to} to={n.to} className="wt-sidenav" data-active={isActive(n.to, pathname) || undefined}>
                <n.icon size={18} stroke={1.8} />
                {n.label}
              </NavLink>
            ))}
          </Box>
        ))}
      </Box>
      <AccountMenu
        target={
          <UnstyledButton className="wt-sidebar-user">
            <Person name={user?.name} size={32} />
            <Box style={{ minWidth: 0, flex: 1 }}>
              <Text size="sm" fw={600} c="#e6ebf2" truncate>{user?.name}</Text>
              <Text size="xs" c="#7d8a9e" tt="capitalize" truncate>{user?.role}</Text>
            </Box>
            <IconDots size={16} color="#7d8a9e" />
          </UnstyledButton>
        }
      />
    </Stack>
  );
}

function MoreDrawer({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = NAV.filter((n) => !TABS.includes(n.to) && (!n.admin || user?.role === 'admin'));
  return (
    <Drawer opened={opened} onClose={onClose} position="bottom" size="auto" radius="xl" withCloseButton={false}
      styles={{ content: { paddingBottom: 'env(safe-area-inset-bottom)' } }}>
      <Box w={40} h={4} mx="auto" mb="md" style={{ borderRadius: 4, background: 'var(--wt-border-strong)' }} />
      <Group gap="sm" mb="md">
        <Person name={user?.name} size={44} />
        <Box>
          <Text fw={650}>{user?.name}</Text>
          <Text size="sm" c="dimmed">{user?.email}</Text>
        </Box>
      </Group>
      <Stack gap={4} mb="md">
        {items.map((n) => (
          <UnstyledButton key={n.to} onClick={() => { onClose(); navigate(n.to); }} p="sm" style={{ borderRadius: 12, background: 'var(--wt-surface-2)' }}>
            <Group justify="space-between">
              <Group gap="sm"><n.icon size={20} stroke={1.8} /><Text fw={550}>{n.label}</Text></Group>
              <IconChevronRight size={18} color="var(--wt-subtle)" />
            </Group>
          </UnstyledButton>
        ))}
        <UnstyledButton onClick={() => { onClose(); spotlight.open(); }} p="sm" style={{ borderRadius: 12, background: 'var(--wt-surface-2)' }}>
          <Group gap="sm"><IconSearch size={20} stroke={1.8} /><Text fw={550}>Search</Text></Group>
        </UnstyledButton>
      </Stack>
      <Text className="wt-eyebrow" mb={6}>Appearance</Text>
      <ThemeSwitch />
      <UnstyledButton onClick={logout} mt="md" p="sm" w="100%" style={{ borderRadius: 12, color: 'var(--mantine-color-red-6)' }}>
        <Group gap="sm"><IconLogout size={20} /><Text fw={600}>Sign out</Text></Group>
      </UnstyledButton>
    </Drawer>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  const desktop = useMediaQuery('(min-width: 48em)', true, { getInitialValueInEffect: false });
  const [more, setMore] = useState(false);
  const [scroll] = useWindowScroll();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);

  // Resident pages are public and never need the office sign-in.
  if (pathname === '/request' || pathname.startsWith('/track/')) {
    return (
      <Suspense fallback={<Center h="100dvh"><Loader type="dots" /></Center>}>
        <Routes>
          <Route path="/request" element={<RequestPage />} />
          <Route path="/track/:token" element={<TrackPage />} />
        </Routes>
      </Suspense>
    );
  }
  if (loading) return <Center h="100%"><Loader type="dots" /></Center>;
  if (!user) return <Login />;

  const routes = (
    <Routes>
      <Route path="/" element={<Dispatch />} />
      <Route path="/jobs" element={<Jobs />} />
      <Route path="/jobs/:id" element={<JobDetailPage />} />
      <Route path="/customers" element={<Customers />} />
      <Route path="/customers/:id" element={<Customers />} />
      <Route path="/forecast" element={<Forecast />} />
      <Route path="/fleet" element={<Fleet />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/billing" element={<Billing />} />
      <Route path="/billing/:id" element={<Billing />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );

  const section = pathname.split('/')[1] ?? '';
  return (
    <AppShell navbar={{ width: 248, breakpoint: 'sm', collapsed: { mobile: true } }} padding={0}>
      <AppShell.Navbar className="wt-sidebar"><Sidebar pathname={pathname} /></AppShell.Navbar>
      <AppShell.Main>
        {!desktop && (
          <header className="wt-topbar" data-scrolled={scroll.y > 4 || undefined}>
            <Brand compact />
            <Group gap={4}>
              <ActionIcon variant="subtle" color="gray" size={38} radius="xl" onClick={() => spotlight.open()} aria-label="Search"><IconSearch size={20} /></ActionIcon>
              <NotificationsBell />
              <UnstyledButton onClick={() => setMore(true)} aria-label="Account"><Person name={user.name} size={34} /></UnstyledButton>
            </Group>
          </header>
        )}
        <Box className="wt-page">
          <motion.div key={section} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}>
            <Box className="wt-page-inner">
              <Suspense fallback={<Center h={240}><Loader type="dots" /></Center>}>{routes}</Suspense>
            </Box>
          </motion.div>
        </Box>
      </AppShell.Main>

      {!desktop && (
        <nav className="wt-tabbar" aria-label="Main">
          {NAV.filter((n) => TABS.includes(n.to)).map((n) => (
            <NavLink key={n.to} to={n.to} className="wt-tab" data-active={isActive(n.to, pathname) || undefined}>
              <span className="wt-tab-icon"><n.icon size={22} stroke={isActive(n.to, pathname) ? 2.1 : 1.7} /></span>
              {n.label}
            </NavLink>
          ))}
          <button className="wt-tab" data-active={NAV.some((n) => !TABS.includes(n.to) && isActive(n.to, pathname)) || undefined} onClick={() => setMore(true)}>
            <span className="wt-tab-icon"><IconDots size={22} /></span>
            More
          </button>
        </nav>
      )}
      <MoreDrawer opened={more} onClose={() => setMore(false)} />
      <SearchActions />
    </AppShell>
  );
}
