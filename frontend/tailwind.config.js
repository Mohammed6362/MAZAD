/**
 * يحدد الملفات التي يفحصها Tailwind لاستخراج أصناف التنسيق وإعداد امتدادات التصميم.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"IBM Plex Sans Arabic"', 'sans-serif'] },
      colors: {
        ink: '#17211d',
        muted: '#748078',
        line: '#e5e9e2',
        canvas: '#f5f6f2',
        forest: '#174d3c',
        lime: '#d6ed78',
      },
      boxShadow: {
        soft: '0 18px 55px rgba(23, 33, 29, .08)',
        card: '0 7px 24px rgba(23, 33, 29, .06)',
      },
    },
  },
  plugins: [],
};
