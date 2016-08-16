test:
	npm test

lint:
	eslint .

deps:
	npm install

.PHONY: deps test lint