ifneq (,$(wildcard .env))
    include .env
    export
endif

.PHONY: build-client build install run dev dev-server dev-client clean patch-version minor-version major-version set-version

build-client:
	cd web && npm run build

build: build-client
	go build -o myairouter .

install: build
	@./website/install.sh --local

run: build
	./myairouter

dev-server:
	go run .

dev-client:
	cd web && npm run dev

dev:
	@echo "Run in separate terminals:"
	@echo "  make dev-server   # Go backend @ $(PORT)"
	@echo "  make dev-client   # Vite HMR on :5173, proxies API to $(VITE_API_URL)"
	@echo ""
	@echo "Open http://localhost:5173 in browser"

prod:
	@echo "Building production binary..."
	$(MAKE) build
	@echo "Run: ./myAiRouter"
	@echo "Open http://$(HOST):$(PORT)"

clean:
	rm -f myAiRouter
	rm -rf web/dist

# version helpers
CURRENT_VERSION := $(shell grep 'myairouter v[0-9]' main.go | sed 's/.*myairouter v//' | sed 's/[^0-9.]*//g')

patch-version:
	@v=$$(grep 'myairouter v[0-9]' main.go | sed 's/.*myairouter v//' | sed 's/[^0-9.]*//g'); \
	major=$$(echo $$v | cut -d. -f1); \
	minor=$$(echo $$v | cut -d. -f2); \
	patch=$$(echo $$v | cut -d. -f3); \
	newv="$$major.$$minor.$$((patch + 1))"; \
	sed -i '' 's/myairouter v[0-9]*\.[0-9]*\.[0-9]*/myairouter v'"$$newv"'/' main.go; \
	sed -i '' 's/"version": "[0-9]*\.[0-9]*\.[0-9]*"/"version": "'"$$newv"'"/' web/package.json; \
	echo "patch bumped to v$$newv"

minor-version:
	@v=$$(grep 'myairouter v[0-9]' main.go | sed 's/.*myairouter v//' | sed 's/[^0-9.]*//g'); \
	major=$$(echo $$v | cut -d. -f1); \
	minor=$$(echo $$v | cut -d. -f2); \
	newv="$$major.$$((minor + 1)).0"; \
	sed -i '' 's/myairouter v[0-9]*\.[0-9]*\.[0-9]*/myairouter v'"$$newv"'/' main.go; \
	sed -i '' 's/"version": "[0-9]*\.[0-9]*\.[0-9]*"/"version": "'"$$newv"'"/' web/package.json; \
	echo "minor bumped to v$$newv"

major-version:
	@v=$$(grep 'myairouter v[0-9]' main.go | sed 's/.*myairouter v//' | sed 's/[^0-9.]*//g'); \
	major=$$(echo $$v | cut -d. -f1); \
	newv="$$((major + 1)).0.0"; \
	sed -i '' 's/myairouter v[0-9]*\.[0-9]*\.[0-9]*/myairouter v'"$$newv"'/' main.go; \
	sed -i '' 's/"version": "[0-9]*\.[0-9]*\.[0-9]*"/"version": "'"$$newv"'"/' web/package.json; \
	echo "major bumped to v$$newv"

set-version:
	@[ -n "$(V)" ] || { echo "Usage: make set-version V=x.y.z"; exit 1; }; \
	sed -i '' 's/myairouter v[0-9]*\.[0-9]*\.[0-9]*/myairouter v$(V)/' main.go; \
	sed -i '' 's/"version": "[0-9]*\.[0-9]*\.[0-9]*"/"version": "$(V)"/' web/package.json; \
	echo "version set to v$(V)"
