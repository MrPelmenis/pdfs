/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
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
      fontFamily: {
        sans: ['Poppins', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
