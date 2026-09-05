package middleware

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"math"
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
		pTokens, cTokens, cat, ttfb, preview, finishReason, err := handleSSEStream(ctx.ResponseWriter, res.Stream, format, ctx.StartTime)
		if err == nil {
			if pTokens > 0 {
				ctx.PromptTokens = pTokens
			}
			if cTokens > 0 {
				ctx.CompletionTokens = cTokens
			}
			if cat > 0 {
				ctx.CachedTokens = cat
			}
			ctx.TTFB = ttfb
			synthBody, _ := json.Marshal(map[string]interface{}{
				"choices": []interface{}{
					map[string]interface{}{
						"message": map[string]interface{}{
							"content": preview,
						},
						"finish_reason": finishReason,
					},
				},
				"usage": map[string]interface{}{
					"prompt_tokens":     ctx.PromptTokens,
					"completion_tokens": ctx.CompletionTokens,
					"cached_tokens":     ctx.CachedTokens,
				},
			})
			ctx.ResponseBody = synthBody
		}
	} else {
		ctx.ResponseBody = res.Body
		if ctx.TTFB <= 0 {
			ctx.TTFB = ctx.Latency
		}
		ctx.ResponseWriter.Header().Set("Content-Type", "application/json")
		ctx.ResponseWriter.WriteHeader(res.ResponseCode)
		_, _ = ctx.ResponseWriter.Write(res.Body)

		var parsedResponse map[string]interface{}
		if err := json.Unmarshal(res.Body, &parsedResponse); err == nil {
			pt, ct, cat := extractTokensFromAnyResponse(parsedResponse)
			if pt > 0 {
				ctx.PromptTokens = pt
			}
			if ct > 0 {
				ctx.CompletionTokens = ct
			}
			if cat > 0 {
				ctx.CachedTokens = cat
			}
		}
	}

	ctx.AddStep("Provider Executor", "success", "Response successfully received from upstream")
	return next(ctx)
}

type Flusher interface {
	Flush()
}

func handleSSEStream(w http.ResponseWriter, stream io.ReadCloser, format string, requestStartTime time.Time) (promptTokens, completionTokens, cachedTokens int, ttfb time.Duration, preview string, finishReason string, err error) {
	defer stream.Close()
	flusher, ok := w.(Flusher)
	if !ok {
		return 0, 0, 0, 0, "", "", fmt.Errorf("response writer does not support flushing")
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	finishReason = "stop"
	hasReceivedFirstToken := false
	var textBuf strings.Builder
	totalChars := 0
	chunkCount := 0

	scanner := bufio.NewScanner(stream)
	// Upstream SSE data lines can be large (inline images, long tool args);
	// the default 64KB cap silently truncates them.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) == 0 {
			continue
		}

		if !hasReceivedFirstToken {
			if !requestStartTime.IsZero() {
				ttfb = time.Since(requestStartTime)
			} else {
				ttfb = 10 * time.Millisecond
			}
			if ttfb <= 0 {
				ttfb = 1 * time.Millisecond
			}
			hasReceivedFirstToken = true
		}

		if pt, ct, cat := extractStreamUsage(line); pt > 0 || ct > 0 || cat > 0 {
			if pt > 0 {
				promptTokens = pt
			}
			if ct > 0 {
				completionTokens = ct
			}
			if cat > 0 {
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

			chunkText, reason := extractDeltaFromChunk(outputLine)
			if chunkText != "" {
				totalChars += len(chunkText)
				chunkCount++
				if textBuf.Len() < 2048 {
					textBuf.WriteString(chunkText)
				}
			}
			if reason != "" {
				finishReason = reason
			}
		}

		if done {
			break
		}
	}

	if completionTokens <= 0 {
		if totalChars > 0 {
			completionTokens = int(math.Max(1, math.Ceil(float64(totalChars)/4.0)))
		} else if chunkCount > 0 {
			completionTokens = chunkCount
		} else if textBuf.Len() > 0 {
			completionTokens = int(math.Max(1, math.Ceil(float64(textBuf.Len())/4.0)))
		} else {
			completionTokens = 1
		}
	}

	return promptTokens, completionTokens, cachedTokens, ttfb, textBuf.String(), finishReason, scanner.Err()
}

func extractDeltaFromChunk(chunk []byte) (string, string) {
	lines := strings.Split(string(chunk), "\n")
	var textBuf strings.Builder
	var lastReason string
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if !strings.HasPrefix(l, "data: ") {
			continue
		}
		data := strings.TrimPrefix(l, "data: ")
		if data == "[DONE]" {
			continue
		}
		var obj map[string]interface{}
		if err := json.Unmarshal([]byte(data), &obj); err != nil {
			continue
		}
		if choices, ok := obj["choices"].([]interface{}); ok && len(choices) > 0 {
			if choice, ok := choices[0].(map[string]interface{}); ok {
				if r, ok := choice["finish_reason"].(string); ok && r != "" {
					lastReason = r
				}
				if delta, ok := choice["delta"].(map[string]interface{}); ok {
					if content, ok := delta["content"].(string); ok && content != "" {
						textBuf.WriteString(content)
					} else if reasoning, ok := delta["reasoning"].(string); ok && reasoning != "" {
						textBuf.WriteString(reasoning)
					} else if reasoningContent, ok := delta["reasoning_content"].(string); ok && reasoningContent != "" {
						textBuf.WriteString(reasoningContent)
					} else if thought, ok := delta["thought"].(string); ok && thought != "" {
						textBuf.WriteString(thought)
					}
				}
				if text, ok := choice["text"].(string); ok && text != "" {
					textBuf.WriteString(text)
				}
			}
		}
		if msg, ok := obj["message"].(map[string]interface{}); ok {
			if content, ok := msg["content"].(string); ok && content != "" {
				textBuf.WriteString(content)
			}
		}
		if response, ok := obj["response"].(string); ok && response != "" {
			textBuf.WriteString(response)
		}
	}
	return textBuf.String(), lastReason
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
		return extractTokensFromAnyResponse(chunk)
	}
	return 0, 0, 0
}

func extractTokensFromAnyResponse(resp map[string]interface{}) (promptTokens, completionTokens, cachedTokens int) {
	if resp == nil {
		return 0, 0, 0
	}

	// 1. Check resp["usage"]
	if usage, ok := resp["usage"].(map[string]interface{}); ok {
		if p, ok := usage["prompt_tokens"].(float64); ok && p > 0 {
			promptTokens = int(p)
		} else if p, ok := usage["input_tokens"].(float64); ok && p > 0 {
			promptTokens = int(p)
		} else if p, ok := usage["prompt_eval_count"].(float64); ok && p > 0 {
			promptTokens = int(p)
		}

		if c, ok := usage["completion_tokens"].(float64); ok && c > 0 {
			completionTokens = int(c)
		} else if c, ok := usage["output_tokens"].(float64); ok && c > 0 {
			completionTokens = int(c)
		} else if c, ok := usage["eval_count"].(float64); ok && c > 0 {
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
	}

	// 2. Check Anthropic streaming message.usage
	if msg, ok := resp["message"].(map[string]interface{}); ok {
		if usage, ok := msg["usage"].(map[string]interface{}); ok {
			if p, ok := usage["input_tokens"].(float64); ok && p > 0 && promptTokens == 0 {
				promptTokens = int(p)
			}
			if c, ok := usage["output_tokens"].(float64); ok && c > 0 && completionTokens == 0 {
				completionTokens = int(c)
			}
		}
	}

	// 3. Check root-level Ollama fields
	if promptTokens == 0 {
		if p, ok := resp["prompt_eval_count"].(float64); ok && p > 0 {
			promptTokens = int(p)
		}
	}
	if completionTokens == 0 {
		if c, ok := resp["eval_count"].(float64); ok && c > 0 {
			completionTokens = int(c)
		}
	}

	// 4. Check Gemini usageMetadata
	if meta, ok := resp["usageMetadata"].(map[string]interface{}); ok {
		if p, ok := meta["promptTokenCount"].(float64); ok && p > 0 && promptTokens == 0 {
			promptTokens = int(p)
		}
		if c, ok := meta["candidatesTokenCount"].(float64); ok && c > 0 && completionTokens == 0 {
			completionTokens = int(c)
		}
	}

	// 5. Total tokens fallback if one is missing
	if usage, ok := resp["usage"].(map[string]interface{}); ok {
		if tot, ok := usage["total_tokens"].(float64); ok && tot > 0 {
			total := int(tot)
			if promptTokens > 0 && completionTokens == 0 && total > promptTokens {
				completionTokens = total - promptTokens
			} else if completionTokens > 0 && promptTokens == 0 && total > completionTokens {
				promptTokens = total - completionTokens
			}
		}
	}

	return promptTokens, completionTokens, cachedTokens
}
