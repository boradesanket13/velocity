.PHONY: help install up down logs test typecheck fmt tf-validate

help:
	@echo "make install    - npm install (backend + frontend); commit the generated lockfiles"
	@echo "make up         - start the full local stack (docker compose)"
	@echo "make down       - stop it and remove volumes"
	@echo "make logs       - tail logs"
	@echo "make test       - backend unit tests"
	@echo "make typecheck  - TypeScript type-check"
	@echo "make fmt        - terraform fmt"
	@echo "make tf-validate- terraform validate (no backend needed)"

install:
	cd backend && npm install
	cd frontend && npm install

up:
	docker compose up --build

down:
	docker compose down -v

logs:
	docker compose logs -f api worker site

test:
	cd backend && npm test

typecheck:
	cd backend && npm run typecheck

fmt:
	terraform -chdir=infra/terraform fmt -recursive

tf-validate:
	terraform -chdir=infra/terraform init -backend=false -input=false
	terraform -chdir=infra/terraform validate
