import localFont from 'next/font/local';

// Self-hosted, never `next/font/google`: that fetches from fonts.googleapis.com
// at *build* time, and Google is unreachable from Iranian IPs — the same reason
// Vercel is off the table. A CI/PaaS build with a cold `.next/cache` would fail.
// Vazirmatn also carries the Persian glyphs the site actually renders; Inter's
// latin subset did not. One variable file covers the whole 100–900 weight axis.
// SIL OFL 1.1 — licence text in `src/assets/fonts/OFL.txt`.
export const vazirmatn = localFont({
  src: '../assets/fonts/Vazirmatn-Variable.woff2',
  variable: '--font-vazirmatn',
  weight: '100 900',
  display: 'swap',
});
