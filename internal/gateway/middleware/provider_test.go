package middleware

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHandleSSEStream_ModelPatterns(t *testing.T) {
	cases := []struct {
		name         string
		format       string
		sseInput     string
		wantContains []string
		wantPrompt   int
		wantComp     int
		wantCached   int
		wantReason   string
	}{
		{
			name:   "DeepSeek reasoning_content + content + cached usage",
			format: "openai",
			sseInput: strings.Join([]string{
				`data: {"choices":[{"delta":{"reasoning_content":"Step 1. "}}]}`,
				`data: {"choices":[{"delta":{"reasoning_content":"Step 2."}}]}`,
				`data: {"choices":[{"delta":{"content":"Final answer."},"finish_reason":"stop"}]}`,
				`data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":45,"prompt_tokens_details":{"cached_tokens":80}}}`,
				`data: [DONE]`,
			}, "\n") + "\n",
			wantContains: []string{`"reasoning_content":"Step 1. "`, `"content":"Final answer."`, `data: [DONE]`},
			wantPrompt:   120,
			wantComp:     45,
			wantCached:   80,
			wantReason:   "stop",
		},
		{
			name:   "GLM reasoning + content",
			format: "openai",
			sseInput: strings.Join([]string{
				`data: {"choices":[{"delta":{"reasoning":"Analyzing GLM prompt..."}}]}`,
				`data: {"choices":[{"delta":{"content":"GLM response ready."},"finish_reason":"stop"}]}`,
				`data: {"choices":[],"usage":{"prompt_tokens":50,"completion_tokens":20}}`,
				`data: [DONE]`,
			}, "\n") + "\n",
			wantContains: []string{`"reasoning":"Analyzing GLM prompt..."`, `"content":"GLM response ready."`, `data: [DONE]`},
			wantPrompt:   50,
			wantComp:     20,
			wantReason:   "stop",
		},
		{
			name:   "Qwen/Qwopus inline <think>...</think> with answer in same chunk",
			format: "openai",
			sseInput: strings.Join([]string{
				`data: {"choices":[{"delta":{"content":"<think>Checking math"}}]}`,
				`data: {"choices":[{"delta":{"content":" 2+2=4</think>The answer is 4."},"finish_reason":"stop"}]}`,
				`data: [DONE]`,
			}, "\n") + "\n",
			wantContains: []string{`<think>Checking math`, `</think>The answer is 4.`, `data: [DONE]`},
			wantReason:   "stop",
		},
		{
			name:   "Anthropic thinking_delta + text_delta + message_stop",
			format: "anthropic",
			sseInput: strings.Join([]string{
				`data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Claude thinking..."}}`,
				`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude answer."}}`,
				`data: {"type":"message_stop"}`,
			}, "\n") + "\n",
			wantContains: []string{`"reasoning_content":"Claude thinking..."`, `"content":"Claude answer."`, `data: [DONE]`},
			wantReason:   "stop",
		},
		{
			name:   "Gemini thought part + text part",
			format: "gemini",
			sseInput: strings.Join([]string{
				`{"candidates":[{"content":{"parts":[{"thought":true,"text":"Gemini thinking..."}]}}]}`,
				`{"candidates":[{"content":{"parts":[{"text":"Gemini answer."}]}}]}`,
			}, "\n") + "\n",
			wantContains: []string{`"reasoning_content":"Gemini thinking..."`, `"content":"Gemini answer."`},
			wantReason:   "stop",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			stream := io.NopCloser(strings.NewReader(tc.sseInput))

			pt, ct, cat, _, preview, finishReason, err := handleSSEStream(rec, stream, tc.format, time.Time{}, "live-test")
			if err != nil {
				t.Fatalf("handleSSEStream error: %v", err)
			}
			body := rec.Body.String()
			for _, sub := range tc.wantContains {
				if !strings.Contains(body, sub) {
					t.Errorf("stream body missing %q\ngot:\n%s", sub, body)
				}
			}
			if preview == "" {
				t.Errorf("expected non-empty preview")
			}
			if tc.wantPrompt > 0 && pt != tc.wantPrompt {
				t.Errorf("promptTokens = %d, want %d", pt, tc.wantPrompt)
			}
			if tc.wantComp > 0 && ct != tc.wantComp {
				t.Errorf("completionTokens = %d, want %d", ct, tc.wantComp)
			}
			if tc.wantCached > 0 && cat != tc.wantCached {
				t.Errorf("cachedTokens = %d, want %d", cat, tc.wantCached)
			}
			if tc.wantReason != "" && finishReason != tc.wantReason {
				t.Errorf("finishReason = %q, want %q", finishReason, tc.wantReason)
			}
		})
	}
}
