/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Poppins", "system-ui", "sans-serif"],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        // --- The Colors You Need (Dynamic CSS Variables) ---
        // Base colors
        "theme-primary": "rgb(var(--color-primary))",
        "theme-primary-hover": "rgb(var(--color-primary-hover))",
        "theme-secondary": "rgb(var(--color-secondary))",
        "theme-muted": "rgb(var(--color-muted))",
        // Backgrounds
        "theme-bg": "rgb(var(--bg-primary))",
        "theme-bg-secondary": "rgb(var(--bg-secondary))",
        "theme-bg-accent": "rgb(var(--bg-accent))",
        "theme-bg-dark": "rgb(var(--bg-dark))",
        // Borders
        "theme-border": "rgb(var(--border-primary))",
        "theme-border-secondary": "rgb(var(--border-secondary))",
        // Interactive states
        "theme-hover": "rgb(var(--bg-hover))",
        // Specialized components
        "theme-comment-bg": "rgb(var(--comment-bg))",
        "theme-text-primary": "rgb(var(--text-primary))",
        "theme-text-dark": "rgb(var(--text-dark))",
        "theme-text-accent": "rgb(var(--text-accent))",
        "theme-text-light": "rgb(var(--text-light))",
        // Chartizer colors
        "chartizer-green": "rgb(var(--chartizer-green), <alpha-value>)",
        "chartizer-blue": "rgb(var(--chartizer-blue), <alpha-value>)",
        "chartizer-yellow": "rgb(var(--chartizer-yellow), <alpha-value>)",
        "chartizer-orange": "rgb(var(--chartizer-orange), <alpha-value>)",

        // --- Your Existing Setup (Preserved for existing components) ---
        main:        '#202124',
        surface:     '#303134',
        raised:      '#3c3f43',
        border:      '#3c3f43',
        accent:      '#8ab4f8',
        success:     '#34a853',
        danger:      '#f28b82',
        warning:     '#f6ae2d',
        ink:         '#e8eaed',
        'ink-dim':   '#9aa0a6',
        'ink-muted': '#5f6368',
      },
      // configs prieks chatbota dalas lai smukaak
      typography: ({ theme }) => ({
        chat: {
          css: {
            '--tw-prose-body':          theme('colors.ink'),
            '--tw-prose-headings':      theme('colors.ink'),
            '--tw-prose-lead':          theme('colors.ink-dim'),
            '--tw-prose-links':         theme('colors.accent'),
            '--tw-prose-bold':          theme('colors.ink'),
            '--tw-prose-counters':      theme('colors.ink-dim'),
            '--tw-prose-bullets':       theme('colors.ink-dim'),
            '--tw-prose-hr':            theme('colors.border'),
            '--tw-prose-quotes':        theme('colors.ink-dim'),
            '--tw-prose-quote-borders': theme('colors.accent'),
            '--tw-prose-captions':      theme('colors.ink-muted'),
            '--tw-prose-code':          theme('colors.accent'),
            '--tw-prose-pre-code':      theme('colors.ink'),
            '--tw-prose-pre-bg':        theme('colors.raised'),
            '--tw-prose-th-borders':    theme('colors.border'),
            '--tw-prose-td-borders':    theme('colors.border'),
            fontSize:     '0.875rem',  
            lineHeight:   '1.65',
            maxWidth:     'none',
            h1: { fontSize: '1.1rem',  fontWeight: '600', marginTop: '1.2em', marginBottom: '0.4em' },
            h2: { fontSize: '1rem',    fontWeight: '600', marginTop: '1.1em', marginBottom: '0.35em', borderBottom: `1px solid ${theme('colors.border')}`, paddingBottom: '0.25em' },
            h3: { fontSize: '0.9rem',  fontWeight: '600', marginTop: '1em',   marginBottom: '0.3em' },
            p:  { marginTop: '0.5em', marginBottom: '0.5em' },
            ul: { marginTop: '0.4em', marginBottom: '0.4em', paddingLeft: '1.25em' },
            ol: { marginTop: '0.4em', marginBottom: '0.4em', paddingLeft: '1.25em' },
            li: { marginTop: '0.15em', marginBottom: '0.15em' },
            code: {
              backgroundColor: theme('colors.raised'),
              padding: '0.15em 0.35em',
              borderRadius: '0.25rem',
              fontFamily: theme('fontFamily.mono').join(', '),
              fontSize: '0.8em',
              fontWeight: '400',
              '&::before': { content: 'none' },
              '&::after':  { content: 'none' },
            },
            pre: {
              backgroundColor: theme('colors.raised'),
              borderRadius: '0.5rem',
              padding: '0.75em 1em',
              overflowX: 'auto',
            },
            blockquote: {
              borderLeftColor: theme('colors.accent'),
              borderLeftWidth: '3px',
              paddingLeft: '0.75em',
              color: theme('colors.ink-dim'),
              fontStyle: 'normal',
              '& p': { margin: 0 },
            },
            hr: { borderColor: theme('colors.border'), marginTop: '1em', marginBottom: '1em' },
            table: { fontSize: '0.8rem' },
            th: { backgroundColor: theme('colors.raised'), padding: '0.4em 0.6em' },
            td: { padding: '0.35em 0.6em' },
          },
        },
      }),
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
