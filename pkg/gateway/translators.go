package gateway

import (
	"encoding/json"
	"strings"
)

// Minimal request structures for mapping
type OpenAIRequest struct {
	Model       string                   `json:"model"`
	Messages    []map[string]interface{} `json:"messages"`
	Stream      bool                     `json:"stream,omitempty"`
	MaxTokens   int                      `json:"max_tokens,omitempty"`
	Temperature float64                  `json:"temperature,omitempty"`
}

type ClaudeRequest struct {
	Model       string                   `json:"model"`
	System      interface{}              `json:"system,omitempty"` // string or array
	Messages    []map[string]interface{} `json:"messages"`
	MaxTokens   int                      `json:"max_tokens,omitempty"`
	Temperature float64                  `json:"temperature,omitempty"`
	Stream      bool                     `json:"stream,omitempty"`
}

type GeminiRequest struct {
	Contents         []map[string]interface{} `json:"contents"`
	SystemInstruction map[string]interface{}  `json:"systemInstruction,omitempty"`
}

// 1. Claude request -> OpenAI request
func ClaudeToOpenAI(claude map[string]interface{}) map[string]interface{} {
	openai := make(map[string]interface{})
	openai["model"] = claude["model"]
	openai["stream"] = claude["stream"]

	if max, ok := claude["max_tokens"].(float64); ok {
		openai["max_tokens"] = int(max)
	}
	if temp, ok := claude["temperature"].(float64); ok {
		openai["temperature"] = temp
	}

	var messages []interface{}

	// System message
	if sys, ok := claude["system"]; ok {
		if sysStr, ok := sys.(string); ok && sysStr != "" {
			messages = append(messages, map[string]interface{}{
				"role":    "system",
				"content": sysStr,
			})
		} else if sysArr, ok := sys.([]interface{}); ok {
			var parts []string
			for _, part := range sysArr {
				if pMap, ok := part.(map[string]interface{}); ok {
					if txt, ok := pMap["text"].(string); ok {
						parts = append(parts, txt)
					}
				}
			}
			if len(parts) > 0 {
				messages = append(messages, map[string]interface{}{
					"role":    "system",
					"content": strings.Join(parts, "\n"),
				})
			}
		}
	}

	// Conver message roles
	if msgArr, ok := claude["messages"].([]interface{}); ok {
		for _, m := range msgArr {
			if mMap, ok := m.(map[string]interface{}); ok {
				role := mMap["role"]
				content := mMap["content"]

				oaiMsg := map[string]interface{}{
					"role":    role,
					"content": content,
				}
				messages = append(messages, oaiMsg)
			}
		}
	}

	openai["messages"] = messages
	return openai
}

// 2. OpenAI request -> Claude request
func OpenAIToClaude(openai map[string]interface{}) map[string]interface{} {
	claude := make(map[string]interface{})
	claude["model"] = openai["model"]
	claude["stream"] = openai["stream"]

	if max, ok := openai["max_tokens"].(float64); ok {
		claude["max_tokens"] = int(max)
	} else if max, ok := openai["max_completion_tokens"].(float64); ok {
		claude["max_tokens"] = int(max)
	} else {
		claude["max_tokens"] = 4096 // Claude requires max_tokens
	}

	if temp, ok := openai["temperature"].(float64); ok {
		claude["temperature"] = temp
	}

	var system string
	var messages []interface{}

	if msgArr, ok := openai["messages"].([]interface{}); ok {
		for _, m := range msgArr {
			if mMap, ok := m.(map[string]interface{}); ok {
				role := mMap["role"]
				content := mMap["content"]

				if role == "system" || role == "developer" {
					if system != "" {
						system += "\n\n"
					}
					if sStr, ok := content.(string); ok {
						system += sStr
					}
				} else {
					claudeMsg := map[string]interface{}{
						"role":    role,
						"content": content,
					}
					messages = append(messages, claudeMsg)
				}
			}
		}
	}

	if system != "" {
		claude["system"] = system
	}
	claude["messages"] = messages
	return claude
}

// 3. OpenAI request -> Gemini request
func OpenAIToGemini(openai map[string]interface{}) map[string]interface{} {
	gemini := make(map[string]interface{})

	var contents []interface{}
	var systemInstruction string

	if msgArr, ok := openai["messages"].([]interface{}); ok {
		for _, m := range msgArr {
			if mMap, ok := m.(map[string]interface{}); ok {
				role := mMap["role"]
				content := mMap["content"]

				if role == "system" || role == "developer" {
					if systemInstruction != "" {
						systemInstruction += "\n\n"
					}
					if sStr, ok := content.(string); ok {
						systemInstruction += sStr
					}
				} else {
					geminiRole := "user"
					if role == "assistant" {
						geminiRole = "model"
					}

					var parts []interface{}
					if cStr, ok := content.(string); ok {
						parts = append(parts, map[string]interface{}{"text": cStr})
					}

					geminiMsg := map[string]interface{}{
						"role":  geminiRole,
						"parts": parts,
					}
					contents = append(contents, geminiMsg)
				}
			}
		}
	}

	gemini["contents"] = contents
	if systemInstruction != "" {
		gemini["systemInstruction"] = map[string]interface{}{
			"parts": []interface{}{
				map[string]interface{}{"text": systemInstruction},
			},
		}
	}

	return gemini
}

// Response chunk translators (for streaming SSE outputs)
func TranslateClaudeChunkToOpenAI(raw []byte) ([]byte, bool) {
	// Claude SSE payload starts with 'data: ' and is JSON
	line := string(raw)
	if !strings.HasPrefix(line, "data: ") {
		return nil, false
	}
	dataStr := strings.TrimPrefix(line, "data: ")
	if strings.TrimSpace(dataStr) == "[DONE]" {
		return []byte("data: [DONE]\n\n"), true
	}

	var data map[string]interface{}
	if err := json.Unmarshal([]byte(dataStr), &data); err != nil {
		return nil, false
	}

	tType, _ := data["type"].(string)
	switch tType {
	case "content_block_delta":
		if delta, ok := data["delta"].(map[string]interface{}); ok {
			if text, ok := delta["text"].(string); ok {
				oaiChunk := map[string]interface{}{
					"object": "chat.completion.chunk",
					"choices": []interface{}{
						map[string]interface{}{
							"delta": map[string]interface{}{
								"content": text,
							},
						},
					},
				}
				oaiBytes, _ := json.Marshal(oaiChunk)
				return append([]byte("data: "), append(oaiBytes, []byte("\n\n")...)...), false
			}
		}
	case "message_stop":
		return []byte("data: [DONE]\n\n"), true
	}

	return nil, false
}

func TranslateGeminiChunkToOpenAI(raw []byte) ([]byte, bool) {
	var data map[string]interface{}
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, false
	}

	if candidates, ok := data["candidates"].([]interface{}); ok && len(candidates) > 0 {
		if first, ok := candidates[0].(map[string]interface{}); ok {
			if content, ok := first["content"].(map[string]interface{}); ok {
				if parts, ok := content["parts"].([]interface{}); ok && len(parts) > 0 {
					if firstPart, ok := parts[0].(map[string]interface{}); ok {
						if text, ok := firstPart["text"].(string); ok {
							oaiChunk := map[string]interface{}{
								"object": "chat.completion.chunk",
								"choices": []interface{}{
									map[string]interface{}{
										"delta": map[string]interface{}{
											"content": text,
										},
									},
								},
							}
							oaiBytes, _ := json.Marshal(oaiChunk)
							return append([]byte("data: "), append(oaiBytes, []byte("\n\n")...)...), false
						}
					}
				}
			}
		}
	}

	return nil, false
}
