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

**После `make migrate`/`make makemigration` (любое изменение
`schema.prisma`) перезапустите backend вручную** (`Ctrl+C`, затем снова
`npm run dev` / `make -C backend dev`). Сгенерированный Prisma-клиент
лежит в `backend/src/generated/prisma` — эта папка в `.gitignore`,
поэтому ts-node-dev не видит там изменений и не перезапускается сам;
сервер продолжает работать со старой версией клиента и будет отдавать
`500` на всё, что касается новых полей, пока не перезапустите его.

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

Если backend отвечает (`make status` показывает 200), но конкретное
действие падает с `500 Internal Server Error` (например, тест не
сохраняется после успешной проверки MD) — почти наверняка не
перезапущен backend после изменения `schema.prisma`, см. раздел про
`make migrate` выше.

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

## Деплой на VPS

Ниже — рабочий план для чистого Ubuntu 22.04/24.04 VPS: backend как
systemd-сервис за Nginx, Postgres в Docker (как и в dev), оба фронтенда —
статическая сборка, отданная тем же Nginx. Предполагается домен,
указывающий на сервер (для HTTPS); если деплоите пока по голому IP —
шаг с certbot и `server_name` в Nginx пропустите/замените на IP.

Схема доменов ниже — пример (`app.example.com` для студентов,
`admin.example.com` для админки). Подставьте свои.

Все команды — от имени обычного пользователя с правами `sudo` (не
`root`). Если логинитесь как `root` — уберите `sudo` из команд.

### Требуемые утилиты и пакеты

| Пакет/утилита | Зачем |
|---|---|
| `curl` | скачивание установочных скриптов |
| `git` | доставка кода на сервер, обновления |
| `make` | все команды сборки/деплоя (`Makefile` в репозитории) |
| `ufw` | firewall (открыть только SSH/80/443) |
| `nodejs` (24.x) + `npm` | backend и сборка обоих фронтендов |
| Docker Engine | PostgreSQL в контейнере (так же, как в dev) |
| `nginx` | раздача статики фронтендов + reverse proxy на backend |
| `certbot` + `python3-certbot-nginx` | HTTPS-сертификат (нужен домен) |
| `openssl` | генерация `JWT_SECRET`; обычно уже стоит в системе |

### 1. Базовая настройка сервера

```bash
ssh <ваш_пользователь>@<IP_СЕРВЕРА>

sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git make ufw

sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 2. Node.js 24 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # >=22
```

### 3. Docker (под Postgres)

```bash
curl -fsSL https://get.docker.com | sudo sh

# чтобы не писать sudo перед каждой docker-командой (make db-up её использует):
sudo usermod -aG docker "$USER"
newgrp docker   # применяет членство в группе docker в текущей сессии
```

### 4. Nginx + Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 5. Код на сервер

Через приватный git-репозиторий (рекомендуется — упрощает будущие обновления):

```bash
sudo mkdir -p /opt/mti-exam-platform
sudo chown "$USER":"$USER" /opt/mti-exam-platform

git clone <ваш-git-url> /opt/mti-exam-platform
cd /opt/mti-exam-platform
```

### 6. База данных

```bash
cd /opt/mti-exam-platform/backend
make db-up   # поднимет Postgres в Docker на порту 5433, как в dev
```

### 7. `backend/.env` — боевые значения

```bash
cp backend/.env.example backend/.env
```

Отредактируйте `backend/.env`:

- `DATABASE_URL` — оставьте как в `.env.example`, если используете
  `make db-up` (порт 5433), либо укажите свою СУБД.
- `JWT_SECRET` — сгенерируйте случайную строку, **не** оставляйте
  dev-значение: `openssl rand -base64 48`
- `CORS_ORIGINS` — реальные домены обоих фронтендов, например
  `https://app.example.com,https://admin.example.com`
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` — свои,
  пароль — надёжный (это единственный админ, создаваемый автоматически)

### 8. Установка, миграции, сборка, первый админ

```bash
cd /opt/mti-exam-platform
make install
make migrate
make seed
make build     # собирает backend/dist + frontend/admin/dist + frontend/user/dist
```

### 9. Backend как systemd-сервис

Замените `<ваш_пользователь>` на пользователя, под которым лежит код
(того же, что в шаге 5):

```bash
sudo tee /etc/systemd/system/mti-backend.service > /dev/null <<'EOF'
[Unit]
Description=MTI Exam Platform backend
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=/opt/mti-exam-platform/backend
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
User=<ваш_пользователь>
EnvironmentFile=/opt/mti-exam-platform/backend/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now mti-backend
sudo systemctl status mti-backend   # должен быть active (running), слушает :4000
```

### 10. Nginx — фронтенды + прокси на backend

```bash
sudo tee /etc/nginx/sites-available/mti-exam-platform > /dev/null <<'EOF'
server {
    listen 80;
    server_name app.example.com;
    root /opt/mti-exam-platform/frontend/user/dist;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 80;
    server_name admin.example.com;
    root /opt/mti-exam-platform/frontend/admin/dist;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/mti-exam-platform /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Проксирование `/api/` в Nginx — подстраховка; на практике фронтенды
ходят напрямую по `VITE_API_URL`, который прописывается **во время
сборки** (шаг 11), так что после смены `.env` фронтендов нужен пересбор.

### 11. `VITE_API_URL` для обоих фронтендов

```bash
echo "VITE_API_URL=https://app.example.com/api" > frontend/user/.env
echo "VITE_API_URL=https://admin.example.com/api" > frontend/admin/.env
make build   # пересобрать с новым VITE_API_URL
```

### 12. HTTPS

```bash
sudo certbot --nginx -d app.example.com -d admin.example.com
```

Certbot сам допишет `listen 443 ssl` и настроит автопродление
(systemd-таймер `certbot.timer`, уже включён по умолчанию).

### 13. Проверка

```bash
curl -I https://app.example.com
curl -I https://admin.example.com
curl -s https://app.example.com/api/health
```

### Обновление после деплоя

```bash
cd /opt/mti-exam-platform
git pull
make install
make migrate
make build
sudo systemctl restart mti-backend
```

`make migrate` использует `prisma migrate deploy` — безопасно на боевой
базе, применяет только новые миграции, ничего не спрашивает интерактивно.
