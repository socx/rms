SHELL := /bin/bash
.PHONY: apply-migration

apply-migration:
	./infra/script/apply-migration.sh

.PHONY: apply-migrations
apply-migrations: apply-migration

