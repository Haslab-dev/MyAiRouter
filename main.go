package main

import (
	"embed"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

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
			fmt.Println("myairouter v0.2.1")
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

	logger.Log("Starting myAiRouter...")

	// 1. Initialize SQLite Database
	if err := db.InitDB(); err != nil {
		logger.Log("Failed to initialize database: %v", err)
		os.Exit(1)
	}
	logger.Log("Database initialized successfully.")

	// 2. Setup Server Routing
	mux := http.NewServeMux()

	// Register compatibility V1 gateway endpoints
	internalGateway.RegisterGatewayRoutes(mux)

	// Register admin REST endpoints
	gateway.RegisterAdminRoutes(mux)

	// Setup embedded skills sub-filesystem
	skillsFS, err := fs.Sub(embedFS, "skills")
	if err == nil {
		mux.Handle("/skills/", http.StripPrefix("/skills/", http.FileServer(http.FS(skillsFS))))
	}

	// Setup embedded static files sub-filesystem
	distFS, err := fs.Sub(embedFS, "web/dist")
	if err != nil {
		logger.Log("Failed to retrieve embedded filesystem: %v", err)
		os.Exit(1)
	}

	// SPA router fallback: serve embedded frontend assets
	fileServer := http.FileServer(http.FS(distFS))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// If path matches API endpoints, return 404 instead of serving HTML
		if strings.HasPrefix(r.URL.Path, "/v1/") || strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/skills/") {
			http.NotFound(w, r)
			return
		}

		// Clean path for filesystem query
		cleanPath := filepath.Clean(r.URL.Path)
		if cleanPath == "/" {
			cleanPath = "index.html"
		} else {
			cleanPath = strings.TrimPrefix(cleanPath, "/")
		}

		// Check if file exists in embedded assets
		_, err := distFS.Open(cleanPath)
		if err != nil {
			// File not found (e.g. client-side route like /dashboard/providers)
			// Serve the main index.html to allow SPA router to handle it
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

		// File exists, serve it
		fileServer.ServeHTTP(w, r)
	})

	// Wrap in CORS and Logging middleware
	handler := corsAndLogMiddleware(mux)

	// 3. Start Listener
	port := os.Getenv("PORT")
	if port == "" {
		port = "20128"
	}
	host := os.Getenv("HOST")
	if host == "" {
		host = "0.0.0.0"
	}
	addr := host + ":" + port
	logger.Log("myAiRouter listening on %s", addr)
	if err := http.ListenAndServe(addr, handler); err != nil {
		logger.Log("Server failed to start: %v", err)
		os.Exit(1)
	}
}

func corsAndLogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Setup CORS headers
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, anthropic-version")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		// Log request details
		logger.Log("%s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)

		next.ServeHTTP(w, r)
	})
}
