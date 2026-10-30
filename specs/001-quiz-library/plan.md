# План 003: «Мої квізи»

Джерела: `spec.md`, `.specify/memory/constitution.md`. Рішення ND1 і ND2 чекають погодження; хвилі 0–5 від ND1 не залежать, хвиля 6 — залежить.

## Підхід

Окремий застосунок на стеку English Reader: Vite 7, Preact 10, `@preact/signals`, TypeScript 5.9 (`strict`), `idb`, власний плагін Vite для `sw.js` (без Workbox), Vitest, Playwright. Квізи надходять із `Creator_quiz` скриптом імпорту на етапі збирання вмісту й лежать у застосунку як статичні JSON. Сервера немає.

## Структура (за ND2 — окремий проєкт)

```
Quiz_Library_PWA/
  .specify/memory/constitution.md     з specs/003 у Creator_quiz
  specs/001-quiz-library/             spec, plan, tasks, alignment (переїжджають з Creator_quiz/specs/003)
  content/courses.json                список курсів: id, назва, шляхи до JSON у Creator_quiz/OUTPUT_quiz
  scripts/import-content.mjs          → python3 scripts/import_quizzes.py → public/content/
  scripts/import_quizzes.py           імпортує функції Creator_quiz/tools/build_quiz.py (A3)
  scripts/size.mjs, check-csp.mjs     бюджет JS і перевірка CSP
  public/content/index.json           курси, квізи, хеші вмісту
  public/content/<quiz>.json          {id, meta, strings, questions[{key, …}]}
  public/_headers, manifest.webmanifest, icons/
  src/contracts.ts                    типи вмісту, спроби, експорту
  src/core/content.ts                 завантаження індексу й квізів
  src/core/storage/db.ts              IndexedDB `quiz-library`: attempts, inProgress, meta
  src/core/attempts.ts                запис відповіді, завершення, підсумок за квізом
  src/core/mistakes.ts                помилки = остання відповідь неправильна (FR-32)
  src/core/backup.ts                  експорт, валідація, імпорт (FR-40, FR-41)
  src/app/router.ts, update.ts, install.ts, persist.ts
  src/ui/library/, quiz/, result/, settings/, components/, theme/tokens.css
  src/sw-template.js                  precache застосунку й public/content/**
  tests/unit/, tests/e2e/, tests/fixtures/
```

## Контракти

**Вміст квізу** (`public/content/<quiz>.json`):
- `{ id, contentHash, meta: {title, description, lang, dir}, strings: {…30 ключів spec 001 §8.3}, questions: [{key, title, question, options, correct, feedback}] }`;
- `strings` — повний набір після `resolve_strings`;
- `key` — за A4.

**Індекс** (`public/content/index.json`): `{ version, courses: [{ id, title, quizzes: [{ id, title, questions, contentHash }] }] }`.

**IndexedDB** `quiz-library`, версія 1:
- `attempts` — автоінкремент: `{ quizId, contentHash, mode: 'full'|'mistakes', startedAt, finishedAt, answers: [{ key, choice, correct }], score, total }`;
- `inProgress` — ключ `quizId|mode`: незавершена спроба (FR-30, FR-31);
- `meta` — `persistAsked`, `installHintDismissed`.

**Експорт**: `{ app: 'quiz-library', schemaVersion: 1, exportedAt, appVersion, data: { attempts: [...] } }`. Валідація за зразком `Claude_PWA/js/storage.js`.

**Екран квізу**:
- ідентифікатори й класи шаблону: `#app-bar`, `#chip-counter`, `#chip-score`, `#q-heading`, `#options .option`, `#feedback`, `#dock`, `#btn-next`, `#btn-restart-during`, `#result`, `#result-percent`, `#result-comment`, `#btn-restart`;
- вбудовані `script#quiz-data` і `script#quiz-strings` (FR-21).

## Ресурси й залежності

- **Runtime:** `preact`, `@preact/signals`, `idb` (конституція I.5). `lucide-preact` не беремо: 3 іконки (✓, ✕, шеврон) вбудовано як SVG, як у шаблоні.
- **Dev:** `vite`, `@preact/preset-vite`, `typescript`, `eslint`, `typescript-eslint`, `vitest`, `@vitest/coverage-v8`, `fake-indexeddb`, `happy-dom`, `@playwright/test`. Версії — як в English Reader.
- **Зовнішні:** Python 3.9+ для імпорту вмісту (A3); Node 20.19+ (на Mac є v26.8.1).
- **Cloudflare:** Workers зі статичними файлами, збирання з GitHub (A6). Створення репозиторію, підключення й розгортання — лише з окремим дозволом.

## Хвилі

| Хвиля | Зміст | Залежить від | Результат |
|---|---|---|---|
| 0 | Каркас проєкту, git, перенесення документів | ND2 | `npm run check` на порожньому застосунку зелений |
| 1 | Імпорт вмісту | 0 | 11 квізів у `public/content/`; негативний тест (SC-01) |
| 2 | Ядро: сховище, спроби, помилки, експорт/імпорт | 0 | модульні тести, покриття ≥ 85 % |
| 3 | Інтерфейс: бібліотека, квіз, результат, режим помилок, налаштування | 1, 2 | e2e SC-03, SC-04; аудит SC-02 |
| 4 | PWA: manifest, іконки, service worker, оновлення, persist, інструкція встановлення | 3 | SC-05, SC-07 |
| 5 | Перевірка якості й узгодження | 4 | SC-06, SC-08; `alignment.md` |
| 6 | Розгортання (окремий дозвіл) | 5, ND1 | SC-09 |
| 7 | Два тижні використання (власник) | 6 | SC-10 |

Хвилі 1 і 2 незалежні, але виконавець один, тож ідуть послідовно; субагенти не потрібні.

## Ризики

| Ризик | Вплив | Пом'якшення |
|---|---|---|
| Поведінка екрана квізу розійдеться з шаблоном | Високий | FR-21: той самий DOM-контракт; `audit_page.js` в e2e; перенесення сценаріїв spec 001 AC-21, AC-22 |
| iOS видалить дані разом з іконкою | Середній | `persist()`, нагадування про експорт (FR-42) |
| Зміна внутрішніх функцій `build_quiz.py` зламає імпорт | Середній | тест імпорту в `npm test`; імпорт викликає лише функції з тестом |
| Квізи оновлено — помилки посилаються на старі питання | Низький | ключі питань (A4), FR-02 |
| Sticky-панель поводиться інакше в Safari | Середній | Playwright WebKit iPad/iPhone + ручна перевірка на пристрої (SC-09) |

## Погодження

2026-10-30, власник: «ok plan» на пакет погодження. Погоджено:
- обсяг «Межі» `spec.md` і хвилі 0–7;
- ND1 — публічна адреса `*.workers.dev` і публічний репозиторій, у застосунку лише квізи зі списку курсів;
- ND2 — окремий проєкт `/Users/szubar/Projects/Educational_courses_2026/Quiz_Library_PWA`.

Погодження не дає дозволу на створення репозиторію GitHub, push, налаштування Cloudflare і розгортання (хвиля 6): на кожну з цих дій потрібен окремий дозвіл. Встановлення npm-пакетів з реєстру npm для локальної збірки входить у погоджений обсяг (`plan.md` → «Ресурси й залежності»).
