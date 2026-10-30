# Мої квізи

Особистий застосунок для навчання (PWA): квізи курсів на iPhone, iPad і Mac, офлайн, зі збереженням спроб на пристрої та режимом «Повторити помилки». Квізи надходять з генератора `../Creator_quiz` і проходять його перевірку `tools/build_quiz.py`.

Сервера, облікових записів і аналітики немає; прогрес переноситься між пристроями експортом та імпортом файлу.

## Команди

| Команда | Що робить |
|---|---|
| `npm install` | Встановити залежності (Node 20.19+) |
| `npm run dev` | Розробка на `localhost` |
| `npm run content` | Імпортувати квізи зі списку `content/courses.json` з `../Creator_quiz/OUTPUT_quiz` у `public/content/` (потрібні Python 3.9+ і `Creator_quiz` поруч) |
| `npm test`, `npm run test:coverage` | Модульні тести |
| `npm run test:e2e` | Playwright: WebKit iPad і iPhone, Chromium (аудит екрана квізу, офлайн) |
| `npm run check` | ESLint, `tsc`, збирання, CSP і секрети, бюджет розміру |

Вміст `public/content/` зберігається в репозиторії: збирання на хостингу не має доступу до `Creator_quiz`.

## Документи

- `.specify/memory/constitution.md` — правила проєкту.
- `specs/001-quiz-library/` — специфікація, план, задачі, узгодження.
