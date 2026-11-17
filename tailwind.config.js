/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './App.tsx', './index.tsx', './components/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  future: { hoverOnlyWhenSupported: true },
  theme: { extend: {} },
  plugins: [],
};
