package middleware

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"myAiRouter/internal/gateway/context"
	"myAiRouter/internal/gateway/providers"
)

func Provider(ctx *context.GatewayContext, next HandlerFunc) error {
	p := providers.Get(ctx.Provider)
	if p == nil {
		// Fallback to default OpenAI-compatible handler
		p = providers.Get("openai")
	}

	startTime := time.Now()
	res := p.Execute(ctx.Context, ctx.Connection, ctx.RequestBody)
	ctx.Latency = time.Since(startTime)

	if res.Err != nil {
		ctx.ResponseCode = http.StatusInternalServerError
		ctx.AddStep("Provider Executor", "failed", fmt.Sprintf("Connection check failed: %v", res.Err))
		return res.Err
	}

	ctx.ResponseCode = res.ResponseCode
	ctx.IsStream = res.IsStream

	if res.ResponseCode >= 400 {
		ctx.ResponseBody = res.Body
		ctx.AddStep("Provider Executor", "failed", fmt.Sprintf("Upstream node returned HTTP %d", res.ResponseCode))
		return nil
	}

	format := ctx.Provider
	if format != "anthropic" && format != "gemini" {
		format = "openai"
	}

	if res.IsStream {
		ctx.Stream = res.Stream
		pTokens, cTokens, cat, ttfb, err := handleSSEStream(ctx.ResponseWriter, res.Stream, format)
		if err == nil {
			ctx.PromptTokens = pTokens
			ctx.CompletionTokens = cTokens
			ctx.CachedTokens = cat
			ctx.TTFB = ttfb
		}
	} else {
		ctx.ResponseBody = res.Body
		ctx.ResponseWriter.Header().Set("Content-Type", "application/json")
		ctx.ResponseWriter.WriteHeader(res.ResponseCode)
		_, _ = ctx.ResponseWriter.Write(res.Body)

		var parsedResponse map[string]interface{}
		if err := json.Unmarshal(res.Body, &parsedResponse); err == nil {
			if usage, ok := parsedResponse["usage"].(map[string]interface{}); ok {
				if pVal, ok := usage["prompt_tokens"].(float64); ok {
					ctx.PromptTokens = int(pVal)
				}
				if cVal, ok := usage["completion_tokens"].(float64); ok {
					ctx.CompletionTokens = int(cVal)
				}
				for _, key := range []string{"cache_creation_input_tokens", "cache_read_input_tokens", "cached_tokens"} {
					if v, ok := usage[key].(float64); ok {
						ctx.CachedTokens += int(v)
					}
				}
				if details, ok := usage["prompt_tokens_details"].(map[string]interface{}); ok {
					for _, key := range []string{"cache_creation_input_tokens", "cache_read_input_tokens", "cached_tokens"} {
						if v, ok := details[key].(float64); ok {
							ctx.CachedTokens += int(v)
						}
					}
				}
			}
		}
	}

	ctx.AddStep("Provider Executor", "success", "Response successfully received from upstream")
	return next(ctx)
}

type Flusher interface {
	Flush()
}

func handleSSEStream(w http.ResponseWriter, stream io.ReadCloser, format string) (promptTokens, completionTokens, cachedTokens int, ttfb time.Duration, err error) {
	defer stream.Close()
	flusher, ok := w.(Flusher)
	if !ok {
		return 0, 0, 0, 0, fmt.Errorf("response writer does not support flushing")
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	startTime := time.Now()
	hasReceivedFirstToken := false

	scanner := bufio.NewScanner(stream)
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) == 0 {
			continue
		}

		if !hasReceivedFirstToken {
			ttfb = time.Since(startTime)
			hasReceivedFirstToken = true
		}

		if format == "openai" {
			if pt, ct, cat := extractStreamUsage(line); pt > 0 || ct > 0 || cat > 0 {
				promptTokens = pt
				completionTokens = ct
				cachedTokens = cat
			}
		}

		var outputLine []byte
		var done bool

		switch format {
		case "anthropic":
			outputLine, done = providers.TranslateClaudeChunkToOpenAI([]byte(line))
		case "gemini":
			outputLine, done = providers.TranslateGeminiChunkToOpenAI([]byte(line))
		default:
			outputLine = []byte(line + "\n\n")
			if strings.HasSuffix(line, "[DONE]") {
				done = true
			}
		}

		if len(outputLine) > 0 {
			_, _ = w.Write(outputLine)
			flusher.Flush()

			if promptTokens == 0 && completionTokens == 0 {
				completionTokens += 1
			}
		}

		if done {
			break
		}
	}

	return promptTokens, completionTokens, cachedTokens, ttfb, scanner.Err()
}

func extractStreamUsage(line string) (promptTokens, completionTokens, cachedTokens int) {
	if strings.HasPrefix(line, "data: ") {
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			return 0, 0, 0
		}
		var chunk map[string]interface{}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return 0, 0, 0
		}
		if usage, ok := chunk["usage"].(map[string]interface{}); ok {
			if p, ok := usage["prompt_tokens"].(float64); ok {
				promptTokens = int(p)
			}
			if c, ok := usage["completion_tokens"].(float64); ok {
				completionTokens = int(c)
			}
			for _, key := range []string{"cache_creation_input_tokens", "cache_read_input_tokens", "cached_tokens"} {
				if v, ok := usage[key].(float64); ok {
					cachedTokens += int(v)
				}
			}
			if details, ok := usage["prompt_tokens_details"].(map[string]interface{}); ok {
				for _, key := range []string{"cache_creation_input_tokens", "cache_read_input_tokens", "cached_tokens"} {
					if v, ok := details[key].(float64); ok {
						cachedTokens += int(v)
					}
				}
			}
			if promptTokens > 0 || completionTokens > 0 || cachedTokens > 0 {
				return promptTokens, completionTokens, cachedTokens
			}
		}
	}
	return 0, 0, 0
}
