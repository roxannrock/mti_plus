# MTI+ Exam Platform

Платформа для приёма экзаменов: админ загружает учебный материал →
конвертирует его в MD-тест по заданному шаблону → студенты проходят тест
и видят разбивку результата по разделам экзамена.

## Структура репозитория

```
mti-exam-platform/
  backend/            Express + TypeScript + Prisma + PostgreSQL API
  frontend/
    admin/            React (Vite) — панель администратора
    user/              React (Vite) — кабинет студента
  docs/
    md-template-spec.md          формат MD-теста
    admin-prompt-template.md     промпт для генерации теста через AI
    example-comptia-a-plus.md    пример готового теста (90 вопросов)
```

## Быстрый старт (локально)

### 1. База данных

Нужен PostgreSQL. Для разработки — контейнер:

```bash
docker run -d --name mti-exam-db \
  -e POSTGRES_USER=mti -e POSTGRES_PASSWORD=mti_dev_pw -e POSTGRES_DB=mti_exam \
  -p 5433:5432 postgres:16-alpine
```

### 2. Backend

```bash
cd backend
cp .env.example .env   # поправьте DATABASE_URL/JWT_SECRET/SEED_ADMIN_*
npm install
npm run prisma:migrate  # применяет схему
npm run seed             # создаёт первого админа из SEED_ADMIN_* в .env
npm run dev               # http://localhost:4000
```

### 3. Frontend — админка

```bash
cd frontend/admin
cp .env.example .env
npm install
npm run dev   # http://localhost:5173
```

### 4. Frontend — кабинет студента

```bash
cd frontend/user
cp .env.example .env
npm install
npm run dev   # http://localhost:5174
```

## Как это работает

1. Админ логинится в `frontend/admin`, открывает **Upload Material**,
   копирует промпт, вставляет его вместе с учебным материалом в
   ChatGPT/Claude, получает MD-файл — см. `docs/admin-prompt-template.md`.
2. Вставляет MD в форму загрузки → сайт валидирует формат
   (`docs/md-template-spec.md`) и показывает предпросмотр с ошибками.
3. Сохраняет и публикует тест.
4. Студент в `frontend/user` регистрируется, выбирает опубликованный
   тест, проходит его, получает итоговый процент и разбивку по разделам.
5. Админ видит список участников теста и детальный разбор ответов
   каждого студента.

Правильные ответы никогда не отправляются студенту до отправки его
попытки — подсчёт происходит только на backend.
