package main

import (
	"bytes"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type Flusher interface {
	Flush()
}

func TestResponseWriterFlusher(t *testing.T) {
	rec := httptest.NewRecorder()
	rw := &responseWriter{
		ResponseWriter: rec,
		statusCode:     http.StatusOK,
		body:           bytes.NewBuffer(nil),
	}

	flusher, ok := interface{}(rw).(Flusher)
	if !ok {
		t.Fatalf("expected responseWriter to implement Flusher")
	}

	_, _ = rw.Write([]byte("data: hello\n\n"))
	flusher.Flush()

	if !rec.Flushed {
		t.Errorf("expected underlying recorder to be flushed")
	}
	if rec.Body.String() != "data: hello\n\n" {
		t.Errorf("expected body 'data: hello\\n\\n', got '%s'", rec.Body.String())
	}
}

func TestEmbedPath(t *testing.T) {
	cases := map[string]string{
		"/":                                 "index.html",
		"/index.html":                       "index.html",
		"/assets/index--tHxmiay.js":         "assets/index--tHxmiay.js",
		"/assets/vendor-react-criU07Su.js":  "assets/vendor-react-criU07Su.js",
		"/sw.js":                            "sw.js",
		"/manifest.webmanifest":             "manifest.webmanifest",
		"/assets/../assets/index--tHxmiay.js": "assets/index--tHxmiay.js",
	}
	for in, want := range cases {
		got := embedPath(in)
		if got != want {
			t.Errorf("embedPath(%q) = %q, want %q", in, got, want)
		}
		if strings.Contains(got, "\\") {
			t.Errorf("embedPath(%q) used Windows separators: %q", in, got)
		}
	}
}

func TestDistFSOpensAssetPaths(t *testing.T) {
	distFS, err := fs.Sub(embedFS, "web/dist")
	if err != nil {
		t.Fatalf("web/dist missing from embed: %v", err)
	}
	for _, p := range []string{"index.html", "sw.js", "manifest.webmanifest"} {
		f, err := distFS.Open(embedPath("/" + p))
		if err != nil {
			t.Errorf("Open(%q): %v", p, err)
			continue
		}
		_ = f.Close()
	}
	entries, err := fs.ReadDir(distFS, "assets")
	if err != nil {
		t.Fatalf("assets/: %v", err)
	}
	foundJS := false
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".js") {
			continue
		}
		foundJS = true
		p := embedPath("/assets/" + e.Name())
		f, err := distFS.Open(p)
		if err != nil {
			t.Errorf("Open(%q): %v", p, err)
			continue
		}
		_ = f.Close()
	}
	if !foundJS {
		t.Fatal("no JS assets in web/dist/assets")
	}
}
