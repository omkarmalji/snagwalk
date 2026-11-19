/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        line: token('line'),
        ink: token('ink'),
        'ink-2': token('ink-2'),
        'ink-3': token('ink-3'),
        accent: token('accent'),
        'accent-ink': token('accent-ink'),
        'accent-soft': token('accent-soft'),
        crit: token('crit'),
        'crit-soft': token('crit-soft'),
        major: token('major'),
        'major-soft': token('major-soft'),
        ok: token('ok'),
      },
      fontFamily: {
        sans: ['var(--font-geist)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        // Shape lock: cards 20px, inputs 12px, buttons/chips full pill.
        card: '20px',
        field: '12px',
      },
      boxShadow: {
        lift: '0 1px 0 rgb(var(--ink) / 0.03), 0 8px 24px -12px rgb(var(--ink) / 0.18)',
        paper: '0 1px 2px rgb(17 17 19 / 0.06), 0 24px 48px -24px rgb(17 17 19 / 0.25)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
