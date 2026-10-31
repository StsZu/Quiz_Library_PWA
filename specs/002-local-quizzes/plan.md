# План 002: квізи з диска й створення з матеріалу

Джерела: `spec.md` (погоджено 2026-10-31), `.specify/memory/constitution.md` (поправка 1), `Creator_quiz/schemas/quiz-package.v1.schema.json`, `Creator_quiz/tools/build_quiz.py`, `converter-pwa-youtube/services/processor/src/converter/quiz.py`.

## Підхід

Усе працює на пристрої. Файл читається через `File.text()`, перевіряється в TS і нормалізується в ту саму форму `Quiz`, що й вбудований вміст. Потім файл зберігається в IndexedDB і показується тим самим екраном квізу. Сервера, мережі й нових runtime-залежностей немає.

Правила перевірки не переписуються вручну з нуля, а генеруються з `build_quiz.py`. Скрипт на Python імпортує модуль (як `import_quizzes.py`) і записує в репозиторій `src/core/generated/build-quiz-rules.json`:
- `PRESETS`, `STRING_KEYS` і змінні рядків;
- `LANG_RE`, `OPTION_LABEL_RE`, `CITATION_RE`, `VISUAL_REF_RE`;
- пороги довжини варіантів.

Порушення паритету ловлять спільні фікстури: для кожної Python (`build_quiz.py`) і TS дають однаковий вердикт і однакові ключі питань.

Редактор — окремий модуль, що завантажується через `import()` лише на `#/edit/…`. Чанк потрапляє в precache, тож офлайн працює.

## Структура

```
Quiz_Library_PWA/
  schemas/quiz-package.v1.schema.json   копія з Creator_quiz/schemas/ (тест рівності)
  scripts/export_rules.py               build_quiz.py → src/core/generated/build-quiz-rules.json
  scripts/check_fixtures.py             build_quiz.py на кожній фікстурі → expected.json і keys.json
  src/core/generated/build-quiz-rules.json
  src/core/canonical.ts                 серіалізація як Python json.dumps(sort_keys, ensure_ascii=False) + SHA-256
  src/core/package.ts                   розпізнавання формату, перевірка (errors/warnings), нормалізація → Quiz, id (F-04)
  src/core/userQuizzes.ts               додати, оновити (різниця за ключами), видалити, список, курси з диска
  src/core/editor.ts                    проблеми питання й набору (порт quiz.py), обертання correct, промпт, розбір відповіді
  src/core/storage/db.ts                версія 2: + userQuizzes
  src/core/content.ts                   loadQuiz('local-…') → userQuizzes
  src/core/backup.ts                    schemaVersion 2, імпорт v1 і v2
  src/ui/library/OpenFile.tsx           кнопка, діалоги «Додати» / «Оновити квіз»
  src/ui/library/Library.tsx            курси з диска, позначки, дії, ізоляція помилки
  src/ui/editor/Editor.tsx              лінивий модуль: фрагменти, редактор питання, промпт, вставка
  src/app/router.ts                     + #/edit/<id>
  src/app/files.ts                      зберегти файл: share з файлом (iOS) або завантаження
  assets/icon/icon.svg                  копія джерела Creator_quiz/Creator_quiz-Q-check-v2/icon.svg (FR-95)
  scripts/make_icons.py                 малює ту саму геометрію (коло, лінії з круглими кінцями) непрозорою → public/icons/
  public/favicon.svg, favicon.ico       favicon; public/icons/icon-180/192/512.png, favicon-32.png
  tests/fixtures/quiz-package/          ≥ 15 файлів + expected.json + keys.json
  tests/unit/package.test.ts, canonical.test.ts, userQuizzes.test.ts, editor.test.ts, backup-v2.test.ts, migration.test.ts
  tests/e2e/local-file.spec.ts, editor.spec.ts
```

## Контракти

**IndexedDB `quiz-library`, версія 2.** Наявні сховища без змін, плюс нове `userQuizzes` з keyPath `id`:

```ts
interface UserQuiz {
  id: string                      // F-04: local-<material_id>[--<part_id>] | local-<file slug>
  fileName: string
  state: 'material' | 'draft' | 'ready'
  course: { id: string; title: string } | null   // null → «Мої файли»
  package: QuizPackage            // повний quiz-package v1 (обгортку Creator_quiz загорнуто в пакет)
  quiz: Quiz | null               // нормалізований для екрана квізу; null для material
  warnings: string[]
  addedAt: number; updatedAt: number
}
```

Міграція `upgrade(db, oldVersion)` для `oldVersion < 1` створює сховища версії 1, для `oldVersion < 2` — `userQuizzes`. Наявні дані не зачіпаються.

**Нормалізація** дає той самий `Quiz`, що й `import_quizzes.py`:
- `{id, contentHash, meta, strings, questions[{key, title, question, options, correct, feedback}]}`;
- `strings` — за `resolve_strings`: пресет мови + `strings` з файлу; немає повного набору → помилка, як у Python;
- `key` і `contentHash` — за F-05.

**Експорт v2**: `{ app: 'quiz-library', schemaVersion: 2, exportedAt, appVersion, data: { attempts, userQuizzes: [{id, fileName, state, course, package, addedAt, updatedAt}] } }`. `quiz` і `warnings` не експортуються, їх перераховують під час імпорту.

**Промпт (FR-86)**: шаблон у `src/core/editor.ts`, на основі системного повідомлення `quiz.py` (`propose`). Відповідь моделі: `{"questions":[{title, question, options[3], correct, feedback, answer_fragment_ids, feedback_fragment_ids}]}`.

## Ресурси й залежності

- Runtime без змін: `preact`, `@preact/signals`, `idb` (A8). Валідатор написано вручну.
- Dev без нових пакетів. Перевірка схеми ajv (draft 2020-12) не входить у `npm test`: перевірку прикладу зроблено одноразово 2026-10-31, а паритет тримають фікстури.
- Python 3.9+ і `Creator_quiz` поруч — для `export_rules.py` і `check_fixtures.py` (а `make_icons.py` — лише Python, без Creator_quiz), як для `npm run content`. Збирання на Cloudflare їх не потребує: згенеровані файли лежать у репозиторії.
- `scripts/size.mjs` рахує окремо початковий JS (≤ 80 КБ gzip) і чанк редактора (≤ 30 КБ gzip).

## Хвилі

| Хвиля | Зміст | Залежить від | Результат |
|---|---|---|---|
| 1 | Формат і перевірка: схема, правила, фікстури, canonical, package | — | SC-11, SC-12 |
| 2 | Сховище: міграція, userQuizzes, content, backup v2 | 1 | SC-13, SC-18 (модульно) |
| 3 | Відкриття файлу й бібліотека | 2 | SC-14, SC-15 |
| 4 | Редактор, промпт, збереження файлу | 3 | SC-16, SC-17 |
| 5 | Якість і узгодження | 4 | SC-19, `alignment.md` |
| 6 | Розгортання й перевірка на iPad (окремий дозвіл) | 5 | SC-20 |
| П | Піктограма й favicon (FR-95), незалежна від хвиль 1–4 | — | SC-21; іде в розгортання хвилі 6 або раніше окремим |

Хвиля 4 (P2) не блокує хвилі 5–6 для P1: якщо треба раніше, P1 (хвилі 1–3) можна випустити окремо.

## Ризики

| Ризик | Вплив | Пом'якшення |
|---|---|---|
| Серіалізація TS ≠ Python `json.dumps` (екранування, сурогатні пари, порядок ключів) → інший ключ питання | Високий: розпадається історія помилок | `keys.json` з Python для фікстур з польськими й українськими літерами, лапками, `\n`, ` `, емодзі; SC-12 на всіх 25 вбудованих квізах |
| Правила `build_quiz.py` зміняться, а згенерований файл застаріє | Середній | тест порівнює `build-quiz-rules.json` з новим експортом, якщо `Creator_quiz` поруч; `check_fixtures.py` у чеклісті перед комітом |
| iOS видалить IndexedDB (квізи з диска й чернетки) | Високий | FR-67 `persist()`; експорт v2 з квізами; початковий файл лишається у «Файлах» |
| Збереження файлу у встановленій PWA на iOS (`<a download>` з blob працює ненадійно) | Середній | `navigator.share({files})`, якщо `canShare`, інакше завантаження; ручна перевірка SC-20. Стосується й наявного експорту (T014 ще не перевірено) |
| Чанк редактора перевищить бюджет | Низький | лінивий модуль, окрема межа в `size.mjs` |
| Відповідь зовнішньої моделі з вигаданими `id` фрагментів | Середній | FR-87: помилка в питанні, решта приймається; усі питання непереглянуті |
| Нова піктограма з прозорими кутами → чорні кути на iOS | Середній | `make_icons.py` малює квадрат без `rx`; `check-build.mjs` перевіряє alpha = 255 для всіх PNG іконок |
| Неперевірений текст з файлу | Середній | лише текстові вузли Preact, без `innerHTML`; `source_url` не стає посиланням (FR-69) |

## Погодження

2026-10-31, власник: «ok погоджую» на spec 002, поправку 1 конституції й ND3–ND6 за рекомендаціями. Цей план — наслідок погодження; хвилі 1–5 — локальна робота в межах погодженого обсягу.

Погодження не дає дозволу на коміт, push, розгортання на Cloudflare і зміни в `converter-pwa-youtube` (D-01): на кожну з цих дій потрібен окремий дозвіл.
