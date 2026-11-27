ifneq (,$(wildcard .env))
    include .env
    export
endif

.PHONY: build-client build build-all install run dev dev-server dev-client clean patch-version minor-version major-version set-version

build-client:
	cd web && npm run build

build: build-client
	go build -o myairouter .

PLATFORMS := darwin/amd64 darwin/arm64 linux/amd64 linux/arm64 windows/amd64 windows/arm64

build-all: build-client
	@mkdir -p dist
	@for p in $(PLATFORMS); do \
		os=$${p%/*}; arch=$${p#*/}; \
		ext=""; [ "$$os" = "windows" ] && ext=".exe"; \
		out="dist/myairouter-$$os-$$arch$$ext"; \
		echo "Building $$out..."; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags="-s -w" -o "$$out" . || exit 1; \
	done
	@ls -lh dist/

install: build
	@./website/install.sh --local

run: build
	./myairouter

dev-server:
	@if [ -f $$HOME/go/bin/air ]; then \
		$$HOME/go/bin/air; \
	else \
		go run . start -f; \
	fi
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
	@echo "Run: ./MyAiRouter"
	@echo "Open http://$(HOST):$(PORT)"

clean:
	rm -f myairouter myairouter.exe MyAiRouter
	rm -rf web/dist dist

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
