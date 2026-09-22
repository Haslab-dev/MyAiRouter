package rtk

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"time"

	"myAiRouter/pkg/db"
)

// Caveman levels definition
const (
	CavemanLite  = "lite"
	CavemanFull  = "full"
	CavemanUltra = "ultra"
)

var CavemanPrompts = map[string]string{
	CavemanLite:  "Respond tersely. Keep grammar and full sentences but drop filler, hedging and pleasantries. Pattern: state the thing, the action, the reason. Then next step.",
	CavemanFull:  "Respond like terse caveman. All technical substance stay exact, only fluff die. Drop: articles (a/an/the), filler, pleasantries, hedging. Fragments OK. Short synonyms. Pattern: [thing] [action] [reason]. [next step].",
	CavemanUltra: "Respond ultra-terse. Maximum compression. Telegraphic. Strip conjunctions. One word when one word enough. Pattern: [thing] [action] [reason]. [next step].",
}

// Ponytail levels definition
const (
	PonytailLite  = "lite"
	PonytailFull  = "full"
	PonytailUltra = "ultra"
)

var PonytailPrompts = map[string]string{
	PonytailLite:  "You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written. Before writing code, stop at the first rung that holds: 1) YAGNI? 2) Stdlib does it? Use it. 3) Native platform covers it? Use it. Lite: build what's asked, but name the lazier alternative in one line.",
	PonytailFull:  "You are a lazy senior developer. Lazy means efficient. Full: the ladder enforced (YAGNI, stdlib first). Shortest diff, shortest explanation. Code first. Then at most three short lines: what was skipped, when to add it.",
	PonytailUltra: "You are a lazy senior developer. Lazy means efficient. Ultra: YAGNI extremist. Deletion before addition. Ship the one-liner and challenge the rest of the requirement in the same response.",
}

// 1. System Prompt Injector (Caveman/Ponytail)
func InjectSystemPrompts(body map[string]interface{}, format string, settings *db.Settings) {
	if settings == nil {
		return
	}

	var prompt string
	if settings.CavemanEnabled {
		prompt = CavemanPrompts[settings.CavemanLevel]
	}
	if settings.PonytailEnabled {
		if prompt != "" {
			prompt += "\n\n"
		}
		prompt += PonytailPrompts[settings.PonytailLevel]
	}

	if prompt == "" {
		return
	}

	switch format {
	case "claude":
		injectClaudeSystem(body, prompt)
	case "gemini":
		injectGeminiSystem(body, prompt)
	default:
		injectOpenAISystem(body, prompt)
	}
}

func injectOpenAISystem(body map[string]interface{}, prompt string) {
	messagesObj, exists := body["messages"]
	if !exists {
		messagesObj = body["input"] // Fallback for some shapes
	}

	messages, ok := messagesObj.([]interface{})
	if !ok || len(messages) == 0 {
		// If no messages array exists, set a default system message
		body["messages"] = []interface{}{
			map[string]interface{}{"role": "system", "content": prompt},
		}
		return
	}

	// Try to find existing system message
	var systemMsg map[string]interface{}
	for _, m := range messages {
		if msgMap, ok := m.(map[string]interface{}); ok {
			role := msgMap["role"]
			if role == "system" || role == "developer" {
				systemMsg = msgMap
				break
			}
		}
	}

	if systemMsg != nil {
		content := systemMsg["content"]
		if contentStr, ok := content.(string); ok {
			if contentStr != "" {
				systemMsg["content"] = contentStr + "\n\n" + prompt
			} else {
				systemMsg["content"] = prompt
			}
		} else if contentArr, ok := content.([]interface{}); ok {
			systemMsg["content"] = append(contentArr, map[string]interface{}{"type": "text", "text": prompt})
		}
	} else {
		// Prepend system message
		newMsg := map[string]interface{}{"role": "system", "content": prompt}
		body["messages"] = append([]interface{}{newMsg}, messages...)
	}
}

func injectClaudeSystem(body map[string]interface{}, prompt string) {
	sysObj, exists := body["system"]
	if !exists || sysObj == nil {
		body["system"] = prompt
		return
	}

	if sysStr, ok := sysObj.(string); ok {
		if sysStr != "" {
			body["system"] = sysStr + "\n\n" + prompt
		} else {
			body["system"] = prompt
		}
	} else if sysArr, ok := sysObj.([]interface{}); ok {
		body["system"] = append(sysArr, map[string]interface{}{"type": "text", "text": prompt})
	}
}

func injectGeminiSystem(body map[string]interface{}, prompt string) {
	// Gemini instruction: body["systemInstruction"] or body["system_instruction"]
	target := body
	key := "systemInstruction"
	if _, ok := body["system_instruction"]; ok {
		key = "system_instruction"
	}

	sysObj, exists := target[key]
	if !exists || sysObj == nil {
		target[key] = map[string]interface{}{
			"parts": []interface{}{map[string]interface{}{"text": prompt}},
		}
		return
	}

	if sysMap, ok := sysObj.(map[string]interface{}); ok {
		if parts, ok := sysMap["parts"].([]interface{}); ok {
			sysMap["parts"] = append(parts, map[string]interface{}{"text": prompt})
		} else {
			sysMap["parts"] = []interface{}{map[string]interface{}{"text": prompt}}
		}
	}
}

// 2. Bolt (RTK) Tool output compressor - mutates map in-place
func CompressMessages(body map[string]interface{}, enabled bool) {
	if !enabled {
		return
	}

	messagesObj, exists := body["messages"]
	if !exists {
		messagesObj = body["input"]
	}

	messages, ok := messagesObj.([]interface{})
	if !ok {
		return
	}

	for _, m := range messages {
		msgMap, ok := m.(map[string]interface{})
		if !ok {
			continue
		}

		// OpenAI responses function output
		if msgMap["type"] == "function_call_output" {
			if outputStr, ok := msgMap["output"].(string); ok {
				msgMap["output"] = compressText(outputStr)
			}
			continue
		}

		// OpenAI tool role
		role := msgMap["role"]
		if role == "tool" {
			if contentStr, ok := msgMap["content"].(string); ok {
				msgMap["content"] = compressText(contentStr)
			} else if contentArr, ok := msgMap["content"].([]interface{}); ok {
				for _, part := range contentArr {
					if pMap, ok := part.(map[string]interface{}); ok {
						if pMap["type"] == "text" {
							if textStr, ok := pMap["text"].(string); ok {
								pMap["text"] = compressText(textStr)
							}
						}
					}
				}
			}
			continue
		}

		// Claude structure: content block with type == "tool_result"
		if contentArr, ok := msgMap["content"].([]interface{}); ok {
			for _, part := range contentArr {
				pMap, ok := part.(map[string]interface{})
				if !ok {
					continue
				}

				if pMap["type"] == "tool_result" && pMap["is_error"] != true {
					if contentStr, ok := pMap["content"].(string); ok {
						pMap["content"] = compressText(contentStr)
					} else if innerArr, ok := pMap["content"].([]interface{}); ok {
						for _, inner := range innerArr {
							if innerMap, ok := inner.(map[string]interface{}); ok {
								if innerMap["type"] == "text" {
									if textStr, ok := innerMap["text"].(string); ok {
										innerMap["text"] = compressText(textStr)
									}
								}
							}
						}
					}
				}
			}
		}
	}
}

func compressText(text string) string {
	if len(text) < 100 { // Skip tiny strings
		return text
	}
	filter := AutoDetectFilter(text)
	if filter == nil {
		return text
	}

	compressed := filter(text)
	if len(compressed) == 0 || len(compressed) >= len(text) {
		return text // Fail-open safety
	}
	return compressed
}

// 3. Headroom Context Compressor Client
type HeadroomRequest struct {
	Messages []interface{} `json:"messages"`
	Model    string        `json:"model"`
}

type HeadroomResponse struct {
	Messages []interface{} `json:"messages"`
}

func CompressWithHeadroom(ctx context.Context, headroomUrl, model string, messages []interface{}) []interface{} {
	client := &http.Client{Timeout: 3 * time.Second}

	reqPayload := HeadroomRequest{
		Messages: messages,
		Model:    model,
	}

	bodyBytes, err := json.Marshal(reqPayload)
	if err != nil {
		return messages
	}

	req, err := http.NewRequestWithContext(ctx, "POST", headroomUrl+"/v1/compress", bytes.NewBuffer(bodyBytes))
	if err != nil {
		return messages
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return messages
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return messages
	}

	var headroomResp HeadroomResponse
	if err := json.NewDecoder(resp.Body).Decode(&headroomResp); err != nil {
		return messages
	}

	if len(headroomResp.Messages) == 0 {
		return messages
	}

	return headroomResp.Messages
}
