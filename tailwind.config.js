/** Tailwind design tokens for Mafia: Shadow Conflict. Build with: npm run build:css */
export default {
  content: ["./public/**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        night: {
          950: "#06080f",
          900: "#0b1020",
          850: "#0f1529",
          800: "#141c36",
          700: "#1d2747",
          600: "#2a365e",
          500: "#3c4a7a",
        },
        gold: {
          200: "#f8e7b9",
          300: "#f2d58c",
          400: "#e6bd62",
          500: "#cfa144",
          600: "#a87d2c",
        },
        blood: {
          400: "#f0707f",
          500: "#e0485a",
          600: "#b5303f",
        },
      },
      fontFamily: {
        display: ["Cinzel", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(230,189,98,.35), 0 8px 30px -8px rgba(230,189,98,.35)",
        card: "0 10px 30px -12px rgba(0,0,0,.6)",
      },
      keyframes: {
        rise: { from: { opacity: 0, transform: "translateY(8px)" }, to: { opacity: 1, transform: "none" } },
        flip: { from: { opacity: 0, transform: "rotateY(90deg) scale(.9)" }, to: { opacity: 1, transform: "none" } },
        pulseSoft: { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.55 } },
      },
      animation: {
        rise: "rise .35s ease-out both",
        flip: "flip .6s cubic-bezier(.2,.8,.2,1) both",
        "pulse-soft": "pulseSoft 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
