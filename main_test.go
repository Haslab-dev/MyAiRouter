package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
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
