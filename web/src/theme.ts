import { createTheme, type MantineColorsTuple } from '@mantine/core';

// A deep "water" blue as the brand colour, tuned for contrast on light and dark.
const water: MantineColorsTuple = [
  '#e7f2ff', '#cfe2fb', '#9ec2f2', '#6aa1ea', '#3f84e3', '#2572df', '#1569de', '#0b5cad', '#004f9c', '#00438a',
];

export const theme = createTheme({
  primaryColor: 'water',
  primaryShade: { light: 7, dark: 5 },
  colors: { water },
  fontFamily: "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  headings: { fontFamily: "'Inter Variable', Inter, system-ui, sans-serif", fontWeight: '700' },
  defaultRadius: 'md',
  cursorType: 'pointer',
  components: {
    Button: { defaultProps: { radius: 'md' } },
    Card: { defaultProps: { radius: 'lg', withBorder: true, padding: 'lg' } },
    Paper: { defaultProps: { radius: 'lg' } },
    Modal: { defaultProps: { radius: 'lg', centered: true, overlayProps: { backgroundOpacity: 0.45, blur: 2 } } },
    Badge: { defaultProps: { radius: 'sm', variant: 'light' } },
    TextInput: { defaultProps: { size: 'md' } },
    PasswordInput: { defaultProps: { size: 'md' } },
    NumberInput: { defaultProps: { size: 'md' } },
    Select: { defaultProps: { size: 'md', checkIconPosition: 'right' } },
    Textarea: { defaultProps: { size: 'md' } },
  },
});
