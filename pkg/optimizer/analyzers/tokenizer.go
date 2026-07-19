package analyzers

func EstimateTokens(text string) int {
	if len(text) == 0 {
		return 0
	}
	return len(text) / 4
}

func EstimateMessageListTokens(messages []interface{}) int {
	tokens := 0
	for _, m := range messages {
		if msgMap, ok := m.(map[string]interface{}); ok {
			if content, ok := msgMap["content"].(string); ok {
				tokens += EstimateTokens(content)
			} else if contentArr, ok := msgMap["content"].([]interface{}); ok {
				for _, part := range contentArr {
					if pMap, ok := part.(map[string]interface{}); ok {
						if textStr, ok := pMap["text"].(string); ok {
							tokens += EstimateTokens(textStr)
						} else if contentStr, ok := pMap["content"].(string); ok {
							tokens += EstimateTokens(contentStr)
						}
					}
				}
			}
		}
	}
	return tokens
}

func CalculateBytes(messages []interface{}) int {
	bytes := 0
	for _, m := range messages {
		if msgMap, ok := m.(map[string]interface{}); ok {
			if content, ok := msgMap["content"].(string); ok {
				bytes += len(content)
			} else if contentArr, ok := msgMap["content"].([]interface{}); ok {
				for _, part := range contentArr {
					if pMap, ok := part.(map[string]interface{}); ok {
						if textStr, ok := pMap["text"].(string); ok {
							bytes += len(textStr)
						} else if contentStr, ok := pMap["content"].(string); ok {
							bytes += len(contentStr)
						}
					}
				}
			}
		}
	}
	return bytes
}
