# myAiRouter - Setup & Run Tutorial

*Inspired by 9router, the reason I made this is because I wanted to make the gateway faster with Golang.*

This tutorial guides you through compiling, running, and configuring your newly ported **myAiRouter** gateway and dashboard.

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
go build -o myAiRouter main.go
```
*This packages the Go web server, the SQLite database migrations, the local skill markdowns, and the compiled Vite frontend assets into a single binary (`myAiRouter`).*

---

## 2. Install

```bash
curl -fsSL https://haslab-dev.github.io/MyAiRouter/website/install.sh | bash
```

Installs to `/usr/local/bin/myairouter`.

---

## 3. Run

```bash
myairouter            # foreground
myairouter start -d   # background (daemon)
myairouter stop       # stop daemon
myairouter restart    # restart daemon
myairouter bg         # background alias
```

By default, the server runs on port `20128`. Set `PORT` to change:
```bash
PORT=8080 myairouter
```

On startup, `myAiRouter` will:
1. Initialize a SQLite database at `~/.myairouter/db.sqlite`.
2. Apply migrations and seed default configuration settings.
3. Start the API gateway at `http://localhost:20128/v1/`.
4. Host the space-dark dashboard at `http://localhost:20128/`.

---

## 4. Build from Source

```bash
cd web && npm install && npm run build && cd ..
go build -o myAiRouter .
```

---

## 5. Configure a Provider Account

1. Open your web browser and navigate to the dashboard at: **`http://localhost:20128/`**.
2. Go to the **Providers** section using the sidebar navigation.
3. Click **Add Connection** in the top right.
4. Select your provider (e.g. *OpenAI*, *Anthropic (Claude)*, or *Google Gemini*).
5. Enter a display name, paste your API Key, and set a priority (lower priority values are tried first).
6. Click **Save Connection**.
7. Click **Test** next to the newly created connection to verify connectivity and validate your credentials against the provider's upstream models.

---

## 6. Authenticate and Route Requests

By default, API gateway authentication is disabled. You can configure and query completions directly:

### Step A: Generate an API Key (Optional)
If you wish to require authorization:
1. Navigate to **Endpoint & Keys** on the dashboard.
2. Under **Developer API Keys**, enter a name (e.g. `VS Code Client`) and click **Create Key**.
3. Copy the generated key (starts with `sk-`).

### Step B: Send a Completion Request
Query the completions endpoint using `curl` (replace `YOUR_API_KEY` with your generated key if login is enabled, or leave the header empty if login is disabled):

```bash
curl -N http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Hello! What is your name?"}
    ],
    "stream": true
  }'
```

*Note: Streamed SSE chunks will automatically translate into OpenAI-compatible structures, even when routing to Anthropic or Gemini upstreams.*

---

## 7. Offline Agent Skills Setup

Your gateway hosts local instructions that autonomous agents (such as Cline, Roo Code, or Claude Code) can load.
* Entry point skill: `http://localhost:20128/skills/myairouter/SKILL.md`
* Chat skill: `http://localhost:20128/skills/myairouter-chat/SKILL.md`
* Token Saving details: `http://localhost:20128/skills/myairouter-token-saver/SKILL.md`

You can view, read, and copy these skill URLs directly under the **Agent Skills** section of the web dashboard.
