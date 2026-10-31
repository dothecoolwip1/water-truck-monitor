import { createTheme, rem, type MantineColorsTuple } from '@mantine/core';

// Brand: a clear glacier blue on a deep ink neutral. Tuned for contrast in light and dark.
const tide: MantineColorsTuple = [
  '#eaf3ff', '#d4e4fd', '#a8c7f7', '#78a8f2', '#5190ee', '#3880ec', '#2877eb', '#1765d1', '#0b59bc', '#004ca6',
];
// Cool neutral used for surfaces and text in dark mode (Mantine "dark" scale).
const ink: MantineColorsTuple = [
  '#c9d1dd', '#aab4c3', '#8a96a8', '#6a778b', '#3a4558', '#262f3e', '#1a212d', '#131924', '#0e131b', '#0a0e15',
];

export const theme = createTheme({
  primaryColor: 'water',
  primaryShade: { light: 7, dark: 5 },
  // Filled badges and buttons on light colours (orange, yellow) switch to dark text.
  autoContrast: true,
  colors: { water: tide, dark: ink },
  white: '#ffffff',
  black: '#0d1420',
  fontFamily: "'Geist Variable', 'Inter Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontFamilyMonospace: "'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace",
  headings: {
    fontFamily: "'Geist Variable', system-ui, sans-serif",
    fontWeight: '650',
    sizes: {
      h1: { fontSize: rem(30), lineHeight: '1.15' },
      h2: { fontSize: rem(24), lineHeight: '1.2' },
      h3: { fontSize: rem(18), lineHeight: '1.3' },
      h4: { fontSize: rem(15), lineHeight: '1.35' },
    },
  },
  fontSizes: { xs: rem(12), sm: rem(13.5), md: rem(15), lg: rem(17), xl: rem(20) },
  radius: { xs: rem(6), sm: rem(8), md: rem(10), lg: rem(14), xl: rem(20) },
  defaultRadius: 'md',
  spacing: { xs: rem(8), sm: rem(12), md: rem(16), lg: rem(24), xl: rem(32) },
  shadows: {
    xs: '0 1px 2px rgb(16 24 40 / 0.05)',
    sm: '0 1px 2px rgb(16 24 40 / 0.06), 0 1px 3px rgb(16 24 40 / 0.08)',
    md: '0 4px 12px -2px rgb(16 24 40 / 0.10), 0 2px 4px -2px rgb(16 24 40 / 0.06)',
    lg: '0 12px 24px -6px rgb(16 24 40 / 0.14), 0 4px 8px -4px rgb(16 24 40 / 0.06)',
    xl: '0 24px 48px -12px rgb(16 24 40 / 0.25)',
  },
  cursorType: 'pointer',
  respectReducedMotion: true,
  components: {
    Button: { defaultProps: { radius: 'md' } },
    ActionIcon: { defaultProps: { radius: 'md' } },
    Card: { defaultProps: { radius: 'lg', withBorder: true, padding: 'lg' }, classNames: { root: 'wt-card' } },
    Paper: { defaultProps: { radius: 'lg' } },
    Modal: {
      defaultProps: { radius: 'lg', centered: true, overlayProps: { backgroundOpacity: 0.4, blur: 6 } },
      classNames: { title: 'wt-modal-title' },
    },
    Drawer: { defaultProps: { overlayProps: { backgroundOpacity: 0.4, blur: 6 } } },
    Badge: { defaultProps: { radius: 'sm', variant: 'light' }, styles: { root: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 } } },
    Menu: { defaultProps: { radius: 'md', shadow: 'lg', transitionProps: { transition: 'pop', duration: 140 } } },
    Popover: { defaultProps: { radius: 'md', shadow: 'lg' } },
    Tooltip: { defaultProps: { radius: 'sm', openDelay: 250, withArrow: true } },
    SegmentedControl: { defaultProps: { radius: 'md' } },
    TextInput: { defaultProps: { size: 'md' } },
    PasswordInput: { defaultProps: { size: 'md' } },
    NumberInput: { defaultProps: { size: 'md', thousandSeparator: ',' } },
    Select: { defaultProps: { size: 'md', checkIconPosition: 'right', comboboxProps: { shadow: 'lg', transitionProps: { transition: 'pop', duration: 120 } } } },
    MultiSelect: { defaultProps: { size: 'md' } },
    TagsInput: { defaultProps: { size: 'md' } },
    Textarea: { defaultProps: { size: 'md', autosize: true, minRows: 2 } },
    Table: { classNames: { table: 'wt-table' } },
    Notification: { defaultProps: { radius: 'md' } },
    Skeleton: { defaultProps: { radius: 'md' } },
  },
});
