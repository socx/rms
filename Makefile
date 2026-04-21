SHELL := /bin/bash
.PHONY: apply-migration

apply-migration:
	./infra/scripts/apply-migration.sh

.PHONY: apply-migrations
apply-migrations: apply-migration

.PHONY: stop
stop:
	./dev/stop.sh


