package providers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"myAiRouter/pkg/db"
)

// OAuth token management for connections created via /api/oauth/*/poll.
// Connections carry Data: apiKey (access token), refreshToken, expiresAt,
// oauthProvider (registry id). Access tokens are short-lived; this file
// refreshes them transparently on 401/403 and pre-emptively when near expiry.

var (
	oauthMu       sync.Mutex
	oauthRefresh  = map[string]time.Time{} // connID -> last refresh attempt (debounce)
)

// OAuthConn returns the connection's access token, refreshing it first when
// it is expired or about to expire (5 min lead).
func OAuthAccessToken(conn *db.ProviderConnection) (string, error) {
	tok, _ := conn.Data["apiKey"].(string)
	if conn.Data["oauthProvider"] == nil {
		return tok, nil // not an OAuth connection
	}
	if tok == "" {
		return "", fmt.Errorf("oauth connection %s has no access token", conn.ID)
	}

	if exp, ok := conn.Data["expiresAt"].(string); ok && exp != "" {
		if t, err := time.Parse(time.RFC3339, exp); err == nil {
			if time.Until(t) > 5*time.Minute {
				return tok, nil
			}
		}
	}
	refreshed, err := RefreshOAuthToken(conn)
	if err != nil {
		// fall back to the stale token; the request may still succeed
		return tok, nil
	}
	return refreshed, nil
}

// RefreshOAuthToken exchanges the stored refresh token for a new access
// token and persists it on the connection. Debounced per connection.
func RefreshOAuthToken(conn *db.ProviderConnection) (string, error) {
	oauthMu.Lock()
	if last, ok := oauthRefresh[conn.ID]; ok && time.Since(last) < 30*time.Second {
		oauthMu.Unlock()
		cur, _ := conn.Data["apiKey"].(string)
		return cur, nil
	}
	oauthRefresh[conn.ID] = time.Now()
	oauthMu.Unlock()

	provID, _ := conn.Data["oauthProvider"].(string)
	refreshTok, _ := conn.Data["refreshToken"].(string)
	if refreshTok == "" {
		return "", fmt.Errorf("no refresh token stored for %s", conn.ID)
	}

	clientID := OAuthClientID(provID, conn)
	tokenURL := OAuthTokenURL(provID, conn)
	if tokenURL == "" || clientID == "" {
		return "", fmt.Errorf("no oauth endpoints for provider %q", provID)
	}

	form := url.Values{}
	form.Set("client_id", clientID)
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshTok)
	if scope := OAuthScope(provID); scope != "" {
		form.Set("scope", scope)
	}

	req, _ := http.NewRequest(http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := SharedHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var data struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
		Error       string `json:"error"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return "", fmt.Errorf("unparsable refresh response: %.200s", body)
	}
	if data.Error != "" || data.AccessToken == "" {
		return "", fmt.Errorf("refresh rejected: %s", data.Error)
	}

	expiresAt := ""
	if data.ExpiresIn > 0 {
		expiresAt = time.Now().UTC().Add(time.Duration(data.ExpiresIn) * time.Second).Format(time.RFC3339)
	}
	updates := map[string]interface{}{
		"data": map[string]interface{}{
			"apiKey":    data.AccessToken,
			"expiresAt": expiresAt,
		},
	}
	// keep the old refresh token if upstream did not rotate it
	if rt, _ := dataVal(body, "refresh_token"); rt != "" {
		updates["data"].(map[string]interface{})["refreshToken"] = rt
	}
	if _, err := db.UpdateConnection(conn.ID, updates); err != nil {
		return "", err
	}
	conn.Data["apiKey"] = data.AccessToken
	conn.Data["expiresAt"] = expiresAt
	return data.AccessToken, nil
}

func dataVal(body []byte, key string) (string, bool) {
	var m map[string]interface{}
	if json.Unmarshal(body, &m) != nil {
		return "", false
	}
	v, _ := m[key].(string)
	return v, v != ""
}
