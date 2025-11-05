import { theme } from './theme'

type TypographyToken =
  | 'caption'
  | 'body'
  | 'bodyLarge'
  | 'heading'
  | 'headingLarge'
  | 'headingXLarge'
  | 'display'
  | 'button'
  | 'input'
  | 'label'
  | 'code'
  | 'terminal'

type TypographyEntry = {
  fontSize: string
  lineHeight: number
  fontFamily: string
}

const createEntry = (
  fontSize: string,
  lineHeight: number,
  fontFamily: string
): TypographyEntry => ({
  fontSize,
  lineHeight,
  fontFamily,
})

const sans = theme.fontFamily.sans
const mono = theme.fontFamily.mono

export const typography: Record<TypographyToken, TypographyEntry> = {
  caption: createEntry(theme.fontSize.caption, theme.lineHeight.compact, sans),
  body: createEntry(theme.fontSize.body, theme.lineHeight.body, sans),
  bodyLarge: createEntry(theme.fontSize.bodyLarge, theme.lineHeight.body, sans),
  heading: createEntry(theme.fontSize.heading, theme.lineHeight.heading, sans),
  headingLarge: createEntry(theme.fontSize.headingLarge, theme.lineHeight.heading, sans),
  headingXLarge: createEntry(theme.fontSize.headingXLarge, theme.lineHeight.heading, sans),
  display: createEntry(theme.fontSize.display, theme.lineHeight.heading, sans),
  button: createEntry(theme.fontSize.button, theme.lineHeight.compact, sans),
  input: createEntry(theme.fontSize.input, theme.lineHeight.body, sans),
  label: createEntry(theme.fontSize.label, theme.lineHeight.compact, sans),
  code: createEntry(theme.fontSize.code, theme.lineHeight.body, mono),
  terminal: createEntry(theme.fontSize.terminal, theme.lineHeight.body, mono),
}
