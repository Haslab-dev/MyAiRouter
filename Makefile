ifneq (,$(wildcard .env))
    include .env
    export
endif

.PHONY: build-client build run dev dev-server dev-client clean

build-client:
	cd web && npm run build

build: build-client
	go build -o myAiRouter .

run: build
	./myAiRouter

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
