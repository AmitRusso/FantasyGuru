/**
 * Design tokens landed now, components later (build-plan.md S3 Decision 3). Colour values
 * live in global.css as CSS variables; this file wires them to Tailwind's colour opacity
 * convention and adds the type scale and spacing from design-brief.md §4.3-§4.4.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        ground: 'rgb(var(--color-ground) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        'surface-raised': 'rgb(var(--color-surface-raised) / <alpha-value>)',
        line: 'rgb(var(--color-line) / <alpha-value>)',
        'line-strong': 'rgb(var(--color-line-strong) / <alpha-value>)',

        text: 'rgb(var(--color-text) / <alpha-value>)',
        'text-2': 'rgb(var(--color-text-2) / <alpha-value>)',
        'text-3': 'rgb(var(--color-text-3) / <alpha-value>)',

        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        'accent-pressed': 'rgb(var(--color-accent-pressed) / <alpha-value>)',

        // Status -- the only saturated colour anywhere in the app (brief §2).
        critical: 'rgb(var(--color-critical) / <alpha-value>)',
        'critical-on': 'rgb(var(--color-critical-on) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        'warning-on': 'rgb(var(--color-warning-on) / <alpha-value>)',
        ok: 'rgb(var(--color-ok) / <alpha-value>)',
        'ok-on': 'rgb(var(--color-ok-on) / <alpha-value>)',
        neutral: 'rgb(var(--color-neutral) / <alpha-value>)',
      },
      fontFamily: {
        // Loaded via @expo-google-fonts/* + expo-font in app/_layout.tsx. Falling back to
        // the platform sans if fonts have not finished loading is handled there, not here.
        display: ['Archivo_700Bold'],
        'display-semibold': ['Archivo_600SemiBold'],
        body: ['IBMPlexSans_400Regular'],
        'body-medium': ['IBMPlexSans_500Medium'],
        'body-semibold': ['IBMPlexSans_600SemiBold'],
        mono: ['IBMPlexMono_500Medium'],
        'mono-bold': ['IBMPlexMono_700Bold'],
      },
      fontSize: {
        // design-brief.md §4.3, dp -> px 1:1 for React Native's density-independent units.
        verdict: ['34px', { lineHeight: '38px', letterSpacing: '-0.02em' }],
        title: ['24px', { lineHeight: '30px', letterSpacing: '-0.015em' }],
        heading: ['19px', { lineHeight: '25px' }],
        body: ['15px', { lineHeight: '22px' }],
        small: ['13px', { lineHeight: '18px' }],
        label: ['11px', { lineHeight: '14px', letterSpacing: '0.09em' }],
        data: ['15px', { lineHeight: '20px' }],
      },
      spacing: {
        screen: '20px', // design-brief.md §3: 20dp horizontal screen padding
      },
    },
  },
  plugins: [],
};
