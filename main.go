package main

import (
	"bytes"
	"context"
	"embed"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"regexp"
	"runtime/debug"
	"strings"
	"time"

	internalGateway "myAiRouter/internal/gateway"
	"myAiRouter/pkg/db"
	"myAiRouter/pkg/gateway"
	"myAiRouter/pkg/logger"
)

//go:embed web/dist skills
var embedFS embed.FS

const pidFile = "/tmp/myairouter.pid"

// versionString is the single source of truth for the app version; the
// Makefile's *-version targets rewrite this literal in place.
const versionString = "myairouter v0.4.0"

func main() {
	gateway.AppVersion = strings.TrimPrefix(versionString, "myairouter ")
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "start":
			// Default: background, no console popup. Control via terminal only.
			// Use `myairouter start -f` for foreground (debug) mode.
			if len(os.Args) > 2 && (os.Args[2] == "-f" || os.Args[2] == "--foreground") {
				stopExistingDuplicates()
				startServer()
				return
			}
			startBackground()
			return
		case "background", "bg":
			startBackground()
			return
		case "status":
			showStatus()
			return
		case "stop":
			stopProcess()
			return
		case "restart":
			stopProcess()
			startBackground()
			return
		case "install":
			installAutostart()
			return
		case "install-global", "global", "setup":
			installGlobal()
			return
		case "uninstall":
			uninstallAutostart()
			return
		case "help", "--help", "-h":
			printHelp()
			return
		case "version", "--version", "-v":
			fmt.Println(versionString)
			return
		}
	}
	// No args: background too — no console popup, control via terminal only.
	startBackground()
}

func printHelp() {
	fmt.Print(`myairouter - AI model router and gateway

Usage:
  myairouter            start server (background, no popup)
  myairouter start      start server (background, no popup)
  myairouter start -f   start server (foreground, debug)
  myairouter status     show server status & running processes
  myairouter stop       stop all running daemon processes
  myairouter restart    restart daemon
  myairouter install    auto-start on boot + crash watchdog (Windows scheduled task)
  myairouter install-global  copy exe to ~/.local/bin + add to PATH (global call)
  myairouter uninstall  remove auto-start (daemon keeps running)
  myairouter bg         start server (background alias)
  myairouter version    print version
  myairouter help       show this help
`)
}

func embedPath(urlPath string) string {
	clean := path.Clean("/" + strings.TrimPrefix(urlPath, "/"))
	if clean == "/" {
		return "index.html"
	}
	return strings.TrimPrefix(clean, "/")
}

func startServer() {
	// Set Go runtime soft memory limit to 128 MB if not explicitly configured via GOMEMLIMIT
	if os.Getenv("GOMEMLIMIT") == "" {
		debug.SetMemoryLimit(128 * 1024 * 1024)
	}

	// Periodic background memory scavenger + WAL checkpoint so usage rows
	// are durable even if the process is force-killed later.
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		for range ticker.C {
			if db.DB != nil {
				_, _ = db.DB.Exec("PRAGMA shrink_memory;")
				db.Checkpoint()
			}
			debug.FreeOSMemory()
		}
	}()

	logger.LogMessage("Starting MyAiRouter...")

	if err := db.InitDB(); err != nil {
		logger.LogError(fmt.Sprintf("Failed to initialize database: %v", err))
		os.Exit(1)
	}
	logger.LogMessage("Database initialized successfully.")

	mux := http.NewServeMux()

	internalGateway.RegisterGatewayRoutes(mux)
	gateway.RegisterAdminRoutes(mux)
	gateway.StartMetricsCollector(30 * time.Second)
	db.StartBackupScheduler()
	skillsFS, err := fs.Sub(embedFS, "skills")
	if err == nil {
		mux.Handle("/skills/", http.StripPrefix("/skills/", http.FileServer(http.FS(skillsFS))))
	}

	distFS, err := fs.Sub(embedFS, "web/dist")
	if err != nil {
		logger.LogError(fmt.Sprintf("Failed to retrieve embedded filesystem: %v", err))
		os.Exit(1)
	}

	fileServer := http.FileServer(http.FS(distFS))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v1/") || strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/skills/") {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")

		cleanPath := embedPath(r.URL.Path)

		_, err := distFS.Open(cleanPath)
		if err != nil {
			indexFile, err := distFS.Open("index.html")
			if err != nil {
				http.Error(w, "Index file not found in assets", http.StatusInternalServerError)
				return
			}
			defer indexFile.Close()
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = io.Copy(w, indexFile)
			return
		}

		fileServer.ServeHTTP(w, r)
	})

	handler := corsAndLogMiddleware(mux)

	port := os.Getenv("PORT")
	if port == "" {
		// Default: 20128 (upstream default). Override with PORT env var.
		port = "20128"
	}
	host := os.Getenv("HOST")
	if host == "" {
		host = "0.0.0.0"
	}
	addr := host + ":" + port
	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	logger.LogMessage(fmt.Sprintf("MyAiRouter listening on %s", addr))

	// Graceful shutdown: SIGINT (Ctrl+C) / SIGTERM (service stop) stop accepting
	// new connections, in-flight streaming requests drain for up to 10s, then
	// the process exits cleanly instead of dropping sockets mid-stream.
	serverErr := make(chan error, 1)
	go func() { serverErr <- srv.ListenAndServe() }()

	sigCh := make(chan os.Signal, 1)
	notifySig(sigCh)

	select {
	case err := <-serverErr:
		if err != nil && err != http.ErrServerClosed {
			logger.LogError(fmt.Sprintf("Server failed to start: %v", err))
			os.Exit(1)
		}
	case <-sigCh:
		logger.LogMessage("Shutdown signal received, draining connections…")
		_ = os.Remove(pidFilePath())
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			logger.LogError(fmt.Sprintf("Forced shutdown after timeout: %v", err))
		} else {
			logger.LogMessage("Shutdown complete.")
		}
		db.Checkpoint()
		db.CloseDB()
	}
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
	body       *bytes.Buffer
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

const maxLogBodyCap = 1024

func (rw *responseWriter) Write(b []byte) (int, error) {
	if rw.body.Len() < maxLogBodyCap {
		spaceLeft := maxLogBodyCap - rw.body.Len()
		if len(b) <= spaceLeft {
			rw.body.Write(b)
		} else {
			rw.body.Write(b[:spaceLeft])
		}
	}
	return rw.ResponseWriter.Write(b)
}

func (rw *responseWriter) Flush() {
	if flusher, ok := rw.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (rw *responseWriter) Unwrap() http.ResponseWriter {
	return rw.ResponseWriter
}

func corsAndLogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, anthropic-version")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		start := time.Now()

		reqBody := ""
		if r.Body != nil && r.Method != http.MethodGet {
			lr := io.LimitReader(r.Body, 2048)
			peekBuf, _ := io.ReadAll(lr)
			if len(peekBuf) > 0 {
				reqBody = sanitizeRequestBody(string(peekBuf))
				r.Body = io.NopCloser(io.MultiReader(bytes.NewReader(peekBuf), r.Body))
			}
		}

		rw := &responseWriter{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
			body:           bytes.NewBuffer(make([]byte, 0, 512)),
		}

		next.ServeHTTP(rw, r)

		duration := time.Since(start)

		logger.LogRequest(r.Method, r.URL.Path, r.RemoteAddr, reqBody)
		logger.LogResponse(rw.statusCode, rw.body.String(), duration.String())
	})
}

var authHeaderRegex = regexp.MustCompile(`(?i)(authorization[\"'\s:]*)(Bearer\s+)?([^\"'\s,}]+)`)
var apiKeyHeaderRegex = regexp.MustCompile(`(?i)(x-api-key[\"'\s:]*)([^\"'\s,}]+)`)

func sanitizeRequestBody(body string) string {
	if body == "" {
		return ""
	}
	sanitized := authHeaderRegex.ReplaceAllString(body, "$1[REDACTED]")
	sanitized = apiKeyHeaderRegex.ReplaceAllString(sanitized, "$1[REDACTED]")
	return sanitized
}
