# MTI+ Exam Platform

Платформа для приёма экзаменов: админ загружает учебный материал →
конвертирует его в MD-тест по заданному шаблону → студенты проходят тест
и видят разбивку результата по разделам экзамена.

## Структура репозитория

```
mti-exam-platform/
  Makefile              команды верхнего уровня (install/dev/build/status/...)
  backend/               Express + TypeScript + Prisma + PostgreSQL API
    Makefile
  frontend/
    admin/               React (Vite) — панель администратора
      Makefile
    user/                React (Vite) — кабинет студента
      Makefile
  docs/
    md-template-spec.md          формат MD-теста
    admin-prompt-template.md     промпт для генерации теста через AI
    example-comptia-a-plus.md    пример готового теста (90 вопросов)
```

Каждый из трёх пакетов (`backend`, `frontend/admin`, `frontend/user`) —
самостоятельное npm-приложение со своими зависимостями и своим `Makefile`.
Корневой `Makefile` просто дирижирует всеми тремя.

## Требования

- Node.js 20+ и npm
- Docker (для локальной PostgreSQL — можно и без Docker, см. ниже)
- `make`

## Установка и первый запуск

```bash
git clone <repo-url> mti-exam-platform
cd mti-exam-platform

make install     # npm install в backend + frontend/admin + frontend/user

cp backend/.env.example backend/.env
cp frontend/admin/.env.example frontend/admin/.env
cp frontend/user/.env.example frontend/user/.env
# в backend/.env поправьте JWT_SECRET и SEED_ADMIN_* на свои значения

make db-up        # поднимает Docker-контейнер с PostgreSQL (dev)
make migrate       # применяет схему Prisma к базе
make seed           # создаёт первого админа из SEED_ADMIN_* в backend/.env
```

Если PostgreSQL уже есть у вас (не через Docker) — просто пропишите
свой `DATABASE_URL` в `backend/.env` и не запускайте `make db-up`.

## Повседневная работа

```bash
make dev
```

Одна команда поднимает базу (если ещё не поднята), backend
(`http://localhost:4000`), админку (`http://localhost:5173`) и кабинет
студента (`http://localhost:5174`) — всё в одном терминале. **Ctrl+C
останавливает все три процесса разом.**

Проверить, что всё поднято и слушает нужные порты:

```bash
make status
```

Другие полезные команды (полный список — `make help`):

| Команда              | Что делает                                         |
|-----------------------|-----------------------------------------------------|
| `make build`          | Продакшн-сборка backend + обоих фронтендов          |
| `make typecheck`      | Проверка типов во всех трёх пакетах                 |
| `make makemigration name="add_x"` | Новая Prisma-миграция после правки schema.prisma |
| `make db-down`        | Остановить dev-базу                                 |
| `make clean`          | Снести `node_modules`/`dist` везде                  |

У каждого пакета есть и свой `Makefile` — если работаете только над
backend, `cd backend && make dev` эквивалентно `make -C backend dev`.

### Учётные записи по умолчанию (dev)

После `make seed` — админ с email/паролем из `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD` в `backend/.env`. Студенты регистрируются сами
через форму на `http://localhost:5174/register`.

## Если что-то не отвечает

Самая частая причина — один и тот же порт (4000/5173/5174) уже занят
другим запущенным процессом (например, вы забыли остановить предыдущий
`make dev`). Проверьте:

```bash
make status                 # что реально отвечает прямо сейчас
lsof -i :4000 -i :5173 -i :5174   # кто держит порты (или `ss -tlnp`)
```

Если видите чужой/старый процесс на нужном порту — остановите его
(`kill <pid>` или Ctrl+C в его терминале) и запустите `make dev` заново.
Vite и ts-node-dev не выводят новый prompt в терминал, пока работают —
это нормально, не зависание.

## Как это работает

1. Админ логинится в `frontend/admin`, открывает **Upload Material**,
   копирует промпт, вставляет его вместе с учебным материалом в
   ChatGPT/Claude, получает MD-файл — см. `docs/admin-prompt-template.md`.
2. Вставляет MD в форму загрузки → сайт валидирует формат
   (`docs/md-template-spec.md`) и показывает предпросмотр с ошибками.
3. Сохраняет и публикует тест.
4. Студент в `frontend/user` регистрируется, выбирает опубликованный
   тест, проходит его (радио-кнопки для вопросов с одним правильным
   ответом, чекбоксы — если несколько), получает итоговый процент и
   разбивку по разделам.
5. Админ видит список участников теста и детальный разбор ответов
   каждого студента.

Правильные ответы никогда не отправляются студенту до отправки его
попытки — подсчёт происходит только на backend.

## Деплой на VPS (кратко)

- `backend`: `make build && make start` (или `npm run build && npm run start`
  внутри `backend/`), перед первым запуском — `npm run prisma:migrate`
  на боевой базе. Нужны реальные `DATABASE_URL`/`JWT_SECRET` в `.env`
  (не dev-значения из примера).
- `frontend/admin` и `frontend/user`: `npm run build` в каждом даёт
  статические файлы в `dist/` — раздавайте их через nginx/Caddy или
  любой статический хостинг, с `VITE_API_URL`, указывающим на реальный
  адрес backend.
- Не забудьте выставить `CORS_ORIGINS` в `backend/.env` на реальные
  домены обеих фронтенд-частей.
