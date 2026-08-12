# myAiRouter - Setup & Run Tutorial

*Inspired by 9router, built with Go for maximum performance and ultra-low footprint.*

This tutorial guides you through compiling, running, and configuring your **myAiRouter** gateway and dashboard.

---

## Memory Comparison

| Router | Runtime | Memory (idle) |
|--------|---------|--------------|
| **MyAiRouter** | Native Go | ~14 MB - 23 MB |
| 9Router Next.js | Next.js server | ~132 MB |
| 9Router Node process | Node.js | ~58 MB |
| **Total 9Router** | Node + Next | **~190 MB** |

**MyAiRouter: 14 MB - 23 MB — 9Router: ~190 MB — ≈8× less memory**

---

## Key Features

1. **Cache Transparency & Verbatim Pass-Through**: By default, requests with compression disabled are passed to provider endpoints completely untouched (zero cloning, zero metadata injection, zero prompt mutation), preserving provider-native prompt caching invariants.
2. **Model-Centric Routing Policies**: Routing, compression, and caching rules are configured per-model rather than globally.
3. **Custom Fallback Models**: Fail over seamlessly to alternative model IDs (e.g. falling back from `deepseek/deepseek-v4-flash` to `opzen/mimo-v2.5-free`) when primary providers return errors or insufficient balance.
4. **Dynamic Cache-Preserving Compression**:
   * **Protected Prefix** (System prompts and tool definitions) — Preserved verbatim.
   * **Middle History** (Older conversation context) — Compressed dynamically using the AST optimizer or RTK fallback.
   * **Protected Suffix** (Last $N$ recent chat messages, default 20) — Preserved verbatim.
5. **Explicit Compression Triggers**:
   * **Proactive (`threshold`)**: Compresses when request exceeds user-specified token threshold.
   * **Reactive (`context_limit`)**: Compresses only when request exceeds model context limits (OpenAI: 128k, Anthropic: 200k, Gemini: 1M).
6. **Live Reloading Watcher**: Native file watching and recompilation of the Go backend using the integrated `air` dev server.

---

## 1. Build the Application

Because `myAiRouter` embeds all frontend assets directly into the Go executable, you only need to run a simple build step to generate the final standalone binary.

### Step A: Build the Frontend (Vite + React)
Navigate to the `web` folder, install dependencies, and build the static production distribution:
```bash
cd web
npm install
npm run build
cd ..
```
*This creates the static HTML, JS, and CSS files inside `web/dist/`.*

### Step B: Compile the Go Binary
Compile the Go entry code to produce a standalone executable binary named `myAiRouter`:
```bash
go build -o myAiRouter .
```
*This packages the Go web server, the SQLite database migrations, local agent skills, and embedded Vite assets into a single binary.*

---

## 2. Install

```bash
curl -fsSL https://haslab-dev.github.io/MyAiRouter/website/install.sh | bash
```

Installs to `$HOME/.local/bin/myairouter` (or `/usr/local/bin/myairouter`).

---

## 3. Run & Process Control

```bash
myairouter            # start server (foreground)
myairouter start      # start server (foreground)
myairouter start -d   # start server (background daemon)
myairouter status     # show server status, running PIDs & listening ports
myairouter stop       # stop all running server processes (auto-sweeps duplicates)
myairouter restart    # restart background daemon
myairouter bg         # background alias
myairouter version    # print version
```

By default, the server runs on port `20128`. Set `PORT` to change:
```bash
PORT=8080 myairouter
```

On startup, `myAiRouter` will:
1. Initialize a SQLite database at `~/.myairouter/db.sqlite`.
2. Apply database migrations and seed default configuration settings.
3. Automatically sweep and terminate any duplicate process instances.
4. Start the API gateway at `http://localhost:20128/v1/`.
5. Host the space-dark dashboard at `http://localhost:20128/`.

---

## 4. Development & Live Reload

To build the client and run the server locally with file watching and live reloading:

```bash
make dev-server       # Launches Go backend (auto-runs `air` hot reload if installed, falling back to `go run .`)
make dev-client       # Launches Vite HMR client on port 5173
```

Open `http://localhost:5173` in your browser. All API requests are automatically proxied to the Go backend.

---

## 5. Request Traces & Routing Analytics

The **Request Traces** dashboard (`http://localhost:20128/traces`) displays routing-focused analytics organized into four distinct sections:

1. **Summary**: High-level execution metrics (Latency, TTFB, Input/Output/Cached Tokens, Cost, Prompt Compression %, Streaming, Attempts count, Fallback & Retry counts).
   * **Cache Hit Status**: Shows explicit gateway cache status (`Yes (Gateway)` / `Yes (Memory)`).
   * **Cached Token Ratio**: Shows the ratio of provider-cached reuse (`Cached Token Ratio: X.Y%`) calculated on the backend.
2. **Route Graph**: Visual node tree for Fallback and Load Balance routing strategies showing per-node execution status (✔ Success, ✖ Failed).
3. **Pipeline**: Clean routing-focused steps (`Resolve Model`, `Request Preparation` (unified rewrite + dynamic compression), `Cache`, `Route`, `Provider`).
4. **Request / Response Preview**: Request metadata (`system`, `user`, `messages`, `chars`, `tokens`, plus detailed compression telemetry) and Response metadata (`preview`, `finish_reason`).

---

## 6. Version Management

```bash
make patch-version          # bump patch (0.1.0 → 0.1.1)
make minor-version          # bump minor, reset patch (0.1.0 → 0.2.0)
make major-version          # bump major, reset minor+patch (0.1.0 → 1.0.0)
make set-version V=x.y.z    # set explicit version
```

Updates both `main.go` (backend) and `web/package.json` (client).

---

## 7. Configure a Provider Account

1. Open your web browser and navigate to the dashboard at: **`http://localhost:20128/`**.
2. Go to the **Providers** section using the sidebar navigation.
3. Add or configure your credentials:
   * **Core Providers**: Configure active connections for *OpenAI*, *Anthropic*, *DeepSeek*, *Gemini*, etc.
   * **Custom Providers**: Click **Add OpenAI/Anthropic Compatible** to register custom target proxies, configure endpoints, and assign credentials. Easily remove nodes completely via the red **Remove** button.
4. Test connectivity next to the connection card to verify configuration.

---

## 8. Authenticate and Route Requests

By default, API gateway authentication is disabled. You can query completions directly:

### Send a Completion Request
Query the completions endpoint using `curl`:

```bash
curl -N http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Hello! What is your name?"}
    ],
    "stream": true
  }'
```

---

## 9. Offline Agent Skills Setup

Your gateway hosts local instructions that autonomous agents (such as Cline, Roo Code, or Claude Code) can load.
* Entry point skill: `http://localhost:20128/skills/myairouter/SKILL.md`
* Chat skill: `http://localhost:20128/skills/myairouter-chat/SKILL.md`
* Token Saving details: `http://localhost:20128/skills/myairouter-token-saver/SKILL.md`

You can view, read, and copy these skill URLs directly under the **Agent Skills** section of the web dashboard.
