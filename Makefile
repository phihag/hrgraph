lint: eslint

eslint:
	eslint .

deps:
	npm install

clean:
	rm -rf node_modules

.PHONY: deps eslint lint clean