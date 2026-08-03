.PHONY: validate new-adr

validate:
	python tools/genesis_cli.py validate

new-adr:
	python tools/genesis_cli.py new-adr "$(TITLE)"
