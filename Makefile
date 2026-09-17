.PHONY: help install install-backend install-admin install-user \
	dev build typecheck migrate makemigration seed db-up db-down db-logs status clean

.DEFAULT_GOAL := help

SHELL := /bin/bash

help: ## Show this help
	@echo ""
	@echo "  MTI+ Exam Platform"
	@echo ""
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""

install: install-backend install-admin install-user ## Install dependencies everywhere (backend + both frontends)

install-backend: ## Install backend dependencies
	cd backend && npm install

install-admin: ## Install admin frontend dependencies
	cd frontend/admin && npm install

install-user: ## Install student frontend dependencies
	cd frontend/user && npm install

db-up: ## Start the local dev PostgreSQL container
	$(MAKE) -C backend db-up

db-down: ## Stop the local dev PostgreSQL container
	$(MAKE) -C backend db-down

db-logs: ## Tail the dev database logs
	$(MAKE) -C backend db-logs

migrate: ## Apply pending Prisma migrations
	$(MAKE) -C backend migrate

makemigration: ## Create a new migration from schema changes (usage: make makemigration name="add_x")
	$(MAKE) -C backend makemigration name="$(name)"

seed: ## Seed the bootstrap admin account from backend/.env
	$(MAKE) -C backend seed

dev: db-up ## Start db + backend + both frontends together (one Ctrl+C stops all)
	@trap 'echo; echo "Stopping..."; kill 0' EXIT INT TERM; \
	(cd backend && npm run dev) & \
	(cd frontend/admin && npm run dev) & \
	(cd frontend/user && npm run dev) & \
	wait

build: ## Production build of backend + both frontends
	cd backend && npm run build
	cd frontend/admin && npm run build
	cd frontend/user && npm run build

typecheck: ## Type-check backend + both frontends
	cd backend && npm run typecheck
	cd frontend/admin && npx tsc -b
	cd frontend/user && npx tsc -b

status: ## Check whether backend/frontends/db are currently reachable
	@printf "%-18s" "backend (4000):"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/health 2>/dev/null || echo "down"
	@printf "%-18s" "admin (5173):"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173 2>/dev/null || echo "down"
	@printf "%-18s" "student (5174):"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5174 2>/dev/null || echo "down"
	@printf "%-18s" "database:"; docker ps --filter name=mti-exam-db --format "{{.Status}}" 2>/dev/null || echo "down"
	@echo ""

clean: ## Remove node_modules and build output everywhere
	$(MAKE) -C backend clean
	$(MAKE) -C frontend/admin clean
	$(MAKE) -C frontend/user clean
