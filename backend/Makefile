.PHONY: help install dev build start migrate makemigration prisma-generate seed seed-students \
	db-up db-down db-logs typecheck test clean

.DEFAULT_GOAL := help

DB_CONTAINER := mti-exam-db
DB_USER := mti
# Override for production: make db-up DB_PASSWORD='<strong password>' (only
# used when the container is first created; must match DATABASE_URL in .env).
DB_PASSWORD ?= mti_dev_pw
DB_NAME := mti_exam
DB_PORT := 5433
# Named volume: the data survives `docker rm` of the container.
DB_VOLUME := mti-exam-pgdata

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

dev: ## Run the API with autoreload (needs db-up first)
	npm run dev

build: ## Compile TypeScript to dist/
	npm run build

start: ## Run the compiled build (after `make build`)
	npm run start

migrate: ## Apply pending Prisma migrations
	npm run prisma:migrate

makemigration: ## Create a new migration from schema changes (usage: make makemigration name="add_x")
	npx prisma migrate dev --name "$(name)"

prisma-generate: ## Regenerate the Prisma client
	npm run prisma:generate

seed: ## Seed the bootstrap admin from .env (SEED_ADMIN_*)
	npm run seed

seed-students: ## Create students from CSV (usage: make seed-students file=students.csv [out=credentials.csv])
	@test -n "$(file)" || { echo 'Usage: make seed-students file=students.csv [out=credentials.csv]'; exit 1; }
	npm run seed:students -- "$(file)" $(if $(out),--out "$(out)")

# Published on 127.0.0.1 only: Docker's port publishing bypasses ufw, so
# "-p 5433:5432" would expose Postgres to the whole internet on a VPS.
db-up: ## Start the PostgreSQL container (make db-up DB_PASSWORD=... on first run in production)
	docker start $(DB_CONTAINER) 2>/dev/null || docker run -d --name $(DB_CONTAINER) \
		--restart unless-stopped \
		-e POSTGRES_USER=$(DB_USER) -e POSTGRES_PASSWORD='$(DB_PASSWORD)' -e POSTGRES_DB=$(DB_NAME) \
		-v $(DB_VOLUME):/var/lib/postgresql/data \
		-p 127.0.0.1:$(DB_PORT):5432 postgres:16-alpine

db-down: ## Stop the local dev PostgreSQL container
	docker stop $(DB_CONTAINER)

db-logs: ## Tail the dev database logs
	docker logs -f $(DB_CONTAINER)

typecheck: ## Type-check without emitting
	npm run typecheck

test: ## Run the test suite (uses the separate mti_exam_test database; needs db-up)
	npm test

clean: ## Remove node_modules and build output
	rm -rf node_modules dist
