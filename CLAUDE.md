# Quiz_Library_PWA («Мої квізи»)

Читати на початку сесії: `.specify/memory/constitution.md` → `specs/002-local-quizzes/tasks.md` (поточна фіча, стан продовження) → її `spec.md`, `plan.md`; завершена фіча 001 — `specs/001-quiz-library/`.

- Стек: Vite + Preact + `@preact/signals` + TypeScript strict + `idb`; власний service worker (`src/sw-template.js`, плагін у `vite.config.ts`).
- Екран квізу повторює DOM-контракт `../Creator_quiz/templates/quiz-md3.html`, щоб `../Creator_quiz/tools/audit_page.js` працював без змін (FR-21); e2e `tests/e2e/audit.spec.ts`.
- Вміст: `npm run content` (Python, імпортує `../Creator_quiz/tools/build_quiz.py`); `Creator_quiz` — лише читання.
- Перевірки перед комітом: `npm run check`, `npm run test:coverage`, `npm run test:e2e`.
- Коміт, push, створення репозиторію GitHub, розгортання на Cloudflare — лише з окремим дозволом власника.
- Спілкування українською, стисло, без емодзі.
