# __tests__/client-build-deps-runtime.test.ts — index

Repo-lint (#E6): client `package.json` declares `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss`, `tsx` in `dependencies` and keeps the four Vite/Tailwind ones out of `devDependencies` — `npm install --omit=dev` drops devDeps, breaking the client `prepare` build (#357).
