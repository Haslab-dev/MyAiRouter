package main

import (
	"bytes"
	"embed"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
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

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "start":
			if len(os.Args) > 2 && os.Args[2] == "-d" {
				startBackground()
				return
			}
		case "background", "bg":
			startBackground()
			return
		case "stop":
			stopProcess()
			return
		case "restart":
			stopProcess()
			startBackground()
			return
		case "help", "--help", "-h":
			printHelp()
			return
		case "version", "--version", "-v":
			fmt.Println("myairouter v0.2.6")
			return
		}
	}
	startServer()
}


func printHelp() {
	fmt.Print(`myairouter - AI model router and gateway

Usage:
  myairouter            start server (foreground)
  myairouter start      start server (foreground)
  myairouter start -d   start server (background daemon)
  myairouter stop       stop daemon
  myairouter restart    restart daemon
  myairouter bg         start server (background alias)
  myairouter version    print version
  myairouter help       show this help
`)
}

func startServer() {
	// Set Go runtime soft memory limit to 128 MB if not explicitly configured via GOMEMLIMIT
	if os.Getenv("GOMEMLIMIT") == "" {
		debug.SetMemoryLimit(128 * 1024 * 1024)
	}

	// Periodic background memory scavenger
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		for range ticker.C {
			if db.DB != nil {
				_, _ = db.DB.Exec("PRAGMA shrink_memory;")
			}
			debug.FreeOSMemory()
		}
	}()

	logger.LogMessage("Starting myAiRouter...")

	if err := db.InitDB(); err != nil {
		logger.LogError(fmt.Sprintf("Failed to initialize database: %v", err))
		os.Exit(1)
	}
	logger.LogMessage("Database initialized successfully.")

	mux := http.NewServeMux()

	internalGateway.RegisterGatewayRoutes(mux)
	gateway.RegisterAdminRoutes(mux)

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

		cleanPath := filepath.Clean(r.URL.Path)
		if cleanPath == "/" {
			cleanPath = "index.html"
		} else {
			cleanPath = strings.TrimPrefix(cleanPath, "/")
		}

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

	logger.LogMessage(fmt.Sprintf("myAiRouter listening on %s", addr))
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.LogError(fmt.Sprintf("Server failed to start: %v", err))
		os.Exit(1)
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
