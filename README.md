# MTI+ Exam Platform

Платформа для приёма экзаменов: админ загружает учебный материал →
конвертирует его в CSV-тест по заданному шаблону → студенты проходят тест
и видят разбивку результата по разделам экзамена.

## Структура репозитория

```
mti-exam-platform/
  Makefile              команды верхнего уровня (install/dev/build/status/...)
  backend/               Express + TypeScript + Prisma + PostgreSQL API
    Makefile
  frontend/              npm workspace: один node_modules на все три пакета
    package.json         корень workspace (shared + admin + user)
    shared/              @mti/shared — общий код обоих фронтендов (TS-исходники,
                         без сборки): axios-клиент, авторизация, тема, страница входа
    admin/               React (Vite) — панель администратора
      Makefile
    user/                React (Vite) — кабинет студента
      Makefile
  docs/
    csv-template-spec.md         формат CSV-теста
    admin-prompt-template.md     промпт для генерации теста через AI
    example-comptia-a-plus.csv   пример готового теста (90 вопросов)
```

`backend` — самостоятельное npm-приложение. `frontend/admin` и
`frontend/user` — два Vite-приложения в одном npm workspace (`frontend/`):
зависимости ставятся одной командой `npm install` в `frontend/` и лежат
в общем `frontend/node_modules`, а общий код (API-клиент, вход, тема)
живёт в `frontend/shared` и правится в одном месте. У каждого приложения
свой `Makefile`; корневой `Makefile` дирижирует всеми.

## Требования

- Node.js 20+ и npm
- Docker (для локальной PostgreSQL — можно и без Docker, см. ниже)
- `make`

## Установка и первый запуск

```bash
git clone <repo-url> mti-exam-platform
cd mti-exam-platform

make install     # npm install в backend + в frontend/ (workspace: shared, admin, user)

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
| `make test`           | Тесты backend (vitest); нужна запущенная dev-база, работают с отдельной БД `mti_exam_test` |
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

Вход везде — по логину (не email), самостоятельной регистрации нет.
После `make seed`:

- админ — логин/пароль из `SEED_ADMIN_LOGIN` / `SEED_ADMIN_PASSWORD` в
  `backend/.env`;
- один тестовый студент — из `SEED_STUDENT_LOGIN` / `SEED_STUDENT_PASSWORD`
  (если заданы в `backend/.env`; можно оставить пустыми, чтобы пропустить).

Реальные студенческие аккаунты будут подтягиваться через LDAP — этот
сид нужен только чтобы было кем залогиниться, пока интеграция не готова.

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
сохраняется после успешной проверки CSV) — почти наверняка не
перезапущен backend после изменения `schema.prisma`, см. раздел про
`make migrate` выше.

## Как это работает

1. Админ логинится в `frontend/admin`, открывает **Upload Material** и
   выбирает CSV-файл с вопросами (UTF-8, запятые — `docs/csv-template-spec.md`).
   CSV можно сделать в Excel/Google Sheets по шаблону или сгенерировать
   через ChatGPT/Claude — см. `docs/admin-prompt-template.md`.
2. Сайт сразу проверяет файл и показывает предпросмотр или ошибки с
   номерами строк.
3. Сохраняет и публикует тест.
   Учётки студентов админ заводит на странице **Студенты**: по одному или
   импортом CSV `логин,фио,пароль` (шаблон — там же; пустой пароль →
   сгенерируется случайный). Сразу после импорта можно скачать CSV с
   логинами и паролями — пароли показываются только один раз, потом их
   можно лишь сбросить. То же из консоли:
   `make seed-students file=students.csv [out=credentials.csv]`.
   Существующие логины пропускаются, их пароли не меняются.
4. Студент в `frontend/user` входит под выданным логином, выбирает опубликованный
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

Пароль БД в репозитории (`mti_dev_pw`) — только для dev. На сервере
придумайте свой и передайте его при **первом** запуске контейнера (потом
пароль хранится в томе контейнера, и `make db-up` просто стартует его):

```bash
cd /opt/mti-exam-platform
DB_PASSWORD=$(openssl rand -hex 24)   # hex — безопасен внутри DATABASE_URL
echo "$DB_PASSWORD"                   # сохраните: он нужен в шаге 7
make db-up DB_PASSWORD="$DB_PASSWORD"
```

Контейнер публикует порт только на `127.0.0.1:5433` (Docker обходит ufw,
поэтому наружу порт не открываем) и перезапускается сам после
перезагрузки сервера (`--restart unless-stopped`).

### 7. `backend/.env` — боевые значения

```bash
cd /opt/mti-exam-platform
cp backend/.env.example backend/.env
```

Отредактируйте `backend/.env`:

- `DATABASE_URL` — если используете `make db-up`, замените в строке из
  `.env.example` только пароль `mti_dev_pw` на пароль из шага 6:
  `postgresql://mti:<пароль>@localhost:5433/mti_exam?schema=public`.
  Либо укажите свою СУБД.
- `HOST` — оставьте `127.0.0.1`: backend доступен только через Nginx. Если
  открыть `:4000` наружу, клиент сможет подделать `X-Forwarded-For` и
  обойти ограничение попыток входа.
- `TRUST_PROXY` — оставьте пустым: в production это `1` (один Nginx перед
  backend). Меняйте, только если перед Nginx стоит ещё один прокси/балансировщик.
- `JWT_SECRET` — сгенерируйте случайную строку, **не** оставляйте
  dev-значение: `openssl rand -base64 48`
- `CORS_ORIGINS` — реальные домены обоих фронтендов, например
  `https://app.example.com,https://admin.example.com`. **Обязателен в
  production**: с `NODE_ENV=production` (его задаёт systemd-юнит, шаг 9)
  backend с пустым `CORS_ORIGINS` не стартует, а `localhost`/`127.0.0.1`
  там автоматически не разрешаются (это есть только в dev).
- `JWT_EXPIRES_IN` — срок жизни токена входа, по умолчанию `12h`. Токен
  хранится в `localStorage` браузера, поэтому длинный срок не ставьте:
  чем короче, тем меньше окно, если токен утечёт. Удалённый пользователь
  или сменённая роль действуют сразу — backend сверяет пользователя с
  базой на каждом запросе.
- `SEED_ADMIN_LOGIN` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` — свои,
  пароль — надёжный (это единственный админ, создаваемый автоматически)

### 8. Установка, миграции, сборка, первый админ

```bash
cd /opt/mti-exam-platform
make install   # в backend заодно генерирует Prisma-клиент (postinstall)
make migrate
make seed
make build     # собирает backend/dist (с prisma generate) + frontend/admin/dist + frontend/user/dist
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
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now mti-backend
sudo systemctl status mti-backend   # должен быть active (running), слушает :4000
```

### 10. Nginx — фронтенды + прокси на backend

Сначала — заголовки безопасности для статики. Токен входа лежит в
`localStorage`, поэтому главная защита от его кражи — не дать выполниться
чужому JS (XSS): строгий `Content-Security-Policy` разрешает скрипты
только с собственного домена. Единственный inline-скрипт — применение
темы до первой отрисовки в `index.html` — разрешается по его SHA-256
хэшу, без `'unsafe-inline'`. Хэш зависит от текста скрипта, поэтому
сниппеты генерируются из собранного `dist/index.html` (сборка — шаг 8)
и **перегенерируются этой же командой после каждого `make build`**
(см. «Обновление после деплоя»):

```bash
cd /opt/mti-exam-platform
for app in user admin; do
  hashes=$(python3 - "frontend/$app/dist/index.html" <<'PY'
import base64, hashlib, re, sys
html = open(sys.argv[1], encoding="utf-8").read()
for body in re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S):
    print("'sha256-" + base64.b64encode(hashlib.sha256(body.encode()).digest()).decode() + "'", end=" ")
PY
)
  sudo tee /etc/nginx/snippets/mti-security-$app.conf > /dev/null <<EOF
add_header Content-Security-Policy "default-src 'self'; script-src 'self' $hashes; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header X-Frame-Options "DENY" always;
EOF
done
```

`connect-src 'self'` подходит, когда `VITE_API_URL` указывает на тот же
домен, что и фронтенд (как в шаге 11: `https://app.example.com/api`).
Если API вынесен на другой домен — допишите его origin в `connect-src`
(например, `connect-src 'self' https://api.example.com`), иначе браузер
заблокирует запросы к API.

Сам сайт:

```bash
sudo tee /etc/nginx/sites-available/mti-exam-platform > /dev/null <<'EOF'
server {
    listen 80;
    server_name app.example.com;
    root /opt/mti-exam-platform/frontend/user/dist;
    index index.html;
    location / {
        include snippets/mti-security-user.conf;
        try_files $uri $uri/ /index.html;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # импорт студентов из CSV бывает долгим
    }
}

server {
    listen 80;
    server_name admin.example.com;
    # Админка собрана под подпуть /admin/ (base в vite.config.ts)
    location = / { return 302 /admin/; }
    location /admin/ {
        alias /opt/mti-exam-platform/frontend/admin/dist/;
        include snippets/mti-security-admin.conf;
        try_files $uri $uri/ /admin/index.html;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # импорт студентов из CSV бывает долгим
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/mti-exam-platform /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

`X-Forwarded-For` обязателен: backend доверяет ровно одному прокси
(`trust proxy`) и по этому заголовку узнаёт реальный IP клиента — на нём
держится ограничение попыток входа (10 неудачных попыток на IP+логин за
15 минут, затем `429`; счётчик в памяти процесса и сбрасывается при
рестарте backend). Заголовки безопасности для самого API (`/api/`)
выставляет backend (helmet), в Nginx их для `/api/` дублировать не нужно.

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
make install   # + prisma generate (postinstall)
make migrate
make build     # backend build тоже заново генерирует Prisma-клиент
sudo systemctl restart mti-backend
```

Если в обновлении менялся `index.html` какого-либо фронтенда (inline-скрипт
темы), перегенерируйте CSP-сниппеты командой из шага 10 и выполните
`sudo nginx -t && sudo systemctl reload nginx` — иначе браузер заблокирует
скрипт со старым хэшем (тема будет мигать при загрузке). Выполнять эту
команду после каждого обновления безопасно.

`make migrate` использует `prisma migrate deploy` — безопасно на боевой
базе, применяет только новые миграции, ничего не спрашивает интерактивно.
