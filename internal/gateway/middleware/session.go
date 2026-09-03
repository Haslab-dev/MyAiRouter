package middleware

import (
	"strings"

	"myAiRouter/internal/gateway/context"
	gwSession "myAiRouter/internal/gateway/session"
	"myAiRouter/pkg/db"
)

func SessionManager(ctx *context.GatewayContext, next HandlerFunc) error {
	// Extract session & workspace IDs from headers or request payload
	sessionID := ctx.ResponseWriter.Header().Get("x-session-id")
	if sessionID == "" && ctx.ResponseWriter.Header() != nil {
		sessionID = ctx.ResponseWriter.Header().Get("X-Session-ID")
	}

	workspace := ""
	if sVal, ok := ctx.RequestBody["session"].(string); ok && sVal != "" {
		sessionID = sVal
	} else if sVal, ok := ctx.RequestBody["session_id"].(string); ok && sVal != "" {
		sessionID = sVal
	}

	if wVal, ok := ctx.RequestBody["workspace"].(string); ok && wVal != "" {
		workspace = wVal
	}

	if sessionID == "" {
		sessionID = "default_session"
	}

	mgr := gwSession.GetManager()
	sess := mgr.GetOrCreate(sessionID, workspace)

	// Content deduplication & hash caching across messages
	skipDeduplication := false
	if ctx.Request != nil {
		cc := ctx.Request.Header.Get("Cache-Control")
		pragma := ctx.Request.Header.Get("Pragma")
		if strings.Contains(strings.ToLower(cc), "no-cache") || strings.Contains(strings.ToLower(cc), "no-store") || strings.ToLower(pragma) == "no-cache" {
			skipDeduplication = true
		}
		if ctx.Request.Header.Get("X-No-Cache") == "true" || ctx.Request.Header.Get("X-Cache-Bypass") == "true" || ctx.Request.Header.Get("X-Skip-Cache") == "true" {
			skipDeduplication = true
		}
	}
	if bVal, ok := ctx.RequestBody["bypass_cache"].(bool); ok && bVal {
		skipDeduplication = true
	}

	settings, _ := db.GetSettings()
	if settings != nil && !settings.RtkEnabled {
		skipDeduplication = true
	}

	memoryHit := false
	if !skipDeduplication {
		if msgs, ok := ctx.RequestBody["messages"].([]interface{}); ok {
			for i, m := range msgs {
				if msgMap, ok := m.(map[string]interface{}); ok {
					if content, ok := msgMap["content"].(string); ok && len(content) > 300 {
						filePath := ""
						if fp, ok := msgMap["name"].(string); ok {
							filePath = fp
						}
						deduped, isHit, _ := mgr.DeduplicateContent(filePath, content)
						if isHit {
							msgMap["content"] = deduped
							msgs[i] = msgMap
							memoryHit = true
						}
					}
				}
			}
		}
	}
	ctx.Metadata["sessionID"] = sess.ID
	ctx.Metadata["workspace"] = sess.Workspace
	ctx.Metadata["memoryCacheHit"] = memoryHit
	ctx.Metadata["session"] = sess

	ctx.AddStep("Session Manager", "success", "Session state & workspace memory hydrated")

	err := next(ctx)

	// Save session updates
	mgr.Save(sess)
	return err
}
