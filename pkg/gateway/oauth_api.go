package gateway

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

// Generic OAuth device-code login for the providers in oauth_providers.go.
// Flow: initiate (ask upstream for a user code) -> user opens the URL ->
// poll (exchange device code for tokens) -> store the connection.
//
// Pending codes live in memory only: a login attempt that outlives the
// daemon is not worth persisting (the user just re-initiates).

type pendingDeviceAuth struct {
	Provider      string
	DeviceCode    string
	UserCode      string
	VerificationURI string
	Interval      int
	ExpiresAt     time.Time
	Extra         map[string]string // qoder/codebuddy state, verifier, etc.
}

var (
	pendingAuthMu sync.Mutex
	pendingAuth   = map[string]*pendingDeviceAuth{} // keyed by provider id
)

func storePending(key string, p *pendingDeviceAuth) {
	pendingAuthMu.Lock()
	defer pendingAuthMu.Unlock()
	pendingAuth[key] = p
}

func takePending(key string) *pendingDeviceAuth {
	pendingAuthMu.Lock()
	defer pendingAuthMu.Unlock()
	p := pendingAuth[key]
	return p
}

func clearPending(key string) {
	pendingAuthMu.Lock()
	defer pendingAuthMu.Unlock()
	delete(pendingAuth, key)
}

// handleOAuthRouter dispatches /api/oauth/{provider}/initiate|poll to the
// generic handlers. (Kilo Code keeps its own endpoints.)
func handleOAuthRouter(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/oauth/")
	parts := strings.Split(strings.Trim(rest, "/"), "/")
	if len(parts) != 2 {
		WriteErrorResponse(w, http.StatusNotFound, "Use /api/oauth/{provider}/initiate|poll")
		return
	}
	switch parts[1] {
	case "initiate":
		handleOAuthInitiate(w, r)
	case "poll":
		handleOAuthPoll(w, r)
	default:
		WriteErrorResponse(w, http.StatusNotFound, "Unknown action "+parts[1])
	}
}

// handleOAuthProviders lists the OAuth-capable providers for the UI.
func handleOAuthProviders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	out := make([]OAuthProvider, 0, len(OAuthProviders))
	for _, p := range OAuthProviders {
		out = append(out, p)
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"providers": out})
}

// handleOAuthInitiate starts a device-code login for the provider in the
// {provider} path segment.
func handleOAuthInitiate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	providerID := providerFromPath(r.URL.Path, "/initiate")
	prov, ok := oauthProviderFor(providerID)
	if !ok {
		WriteErrorResponse(w, http.StatusNotFound, fmt.Sprintf("Unknown OAuth provider %q", providerID))
		return
	}

	switch prov.Flow {
	case "qoder":
		initiateQoder(w, prov)
	case "codebuddy":
		initiateCodeBuddy(w, prov)
	case "cline":
		WriteErrorResponse(w, http.StatusBadRequest, "Cline/ClinePass use a browser callback flow (batch 2)")
	case "kilocode":
		WriteErrorResponse(w, http.StatusBadRequest, "Use /api/oauth/kilocode/initiate")
	default:
		initiateDeviceFlow(w, prov)
	}
}

// providerFromPath extracts "{provider}" from /api/oauth/{provider}/<suffix>.
func providerFromPath(path, suffix string) string {
	path = strings.TrimPrefix(path, "/api/oauth/")
	path = strings.TrimSuffix(path, suffix)
	return strings.Trim(path, "/")
}

// initiateDeviceFlow covers RFC 8628 providers (xAI, Kimi, GitHub Copilot).
func initiateDeviceFlow(w http.ResponseWriter, prov *OAuthProvider) {
	form := url.Values{}
	form.Set("client_id", prov.ClientID)
	form.Set("scope", prov.Scope)

	req, err := http.NewRequest(http.MethodPost, prov.DeviceCodeURL, strings.NewReader(form.Encode()))
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		WriteErrorResponse(w, http.StatusBadGateway, "Device code request failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		WriteErrorResponse(w, resp.StatusCode, fmt.Sprintf("Upstream rejected device code request: %s", truncate(string(body), 300)))
		return
	}

	var data struct {
		DeviceCode              string `json:"device_code"`
		UserCode                string `json:"user_code"`
		VerificationURI         string `json:"verification_uri"`
		VerificationURIComplete string `json:"verification_uri_complete"`
		ExpiresIn               int    `json:"expires_in"`
		Interval                int    `json:"interval"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		WriteErrorResponse(w, http.StatusBadGateway, "Cannot parse device code response: "+err.Error())
		return
	}

	verify := data.VerificationURI
	if verify == "" {
		verify = prov.DeviceAuthURL
	}
	if data.VerificationURIComplete != "" {
		verify = data.VerificationURIComplete
	}
	interval := data.Interval
	if interval <= 0 {
		interval = 5
	}
	expiresIn := data.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 900
	}

	storePending(prov.ID, &pendingDeviceAuth{
		Provider:        prov.ID,
		DeviceCode:      data.DeviceCode,
		UserCode:        data.UserCode,
		VerificationURI: verify,
		Interval:        interval,
		ExpiresAt:       time.Now().Add(time.Duration(expiresIn) * time.Second),
	})

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":           "pending",
		"device_code":      data.DeviceCode,
		"user_code":        data.UserCode,
		"verification_uri": verify,
		"expires_in":       expiresIn,
		"interval":         interval,
	})
}

// initiateQoder asks Qoder for a device code; the user approves it in the
// browser, then poll exchanges it for a job token.
func initiateQoder(w http.ResponseWriter, prov *OAuthProvider) {
	resp, err := http.Post(prov.PollURL[:strings.Index(prov.PollURL, "/deviceToken/poll")]+"/device", "application/json", nil)
	if err != nil {
		WriteErrorResponse(w, http.StatusBadGateway, "Qoder device request failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		WriteErrorResponse(w, http.StatusBadGateway, "Cannot parse Qoder response: "+truncate(string(body), 200))
		return
	}
	deviceCode, _ := data["device_code"].(string)
	if deviceCode == "" {
		deviceCode, _ = data["deviceCode"].(string)
	}
	userCode, _ := data["user_code"].(string)
	if userCode == "" {
		userCode, _ = data["code"].(string)
	}

	storePending(prov.ID, &pendingDeviceAuth{
		Provider:        prov.ID,
		DeviceCode:      deviceCode,
		UserCode:        userCode,
		VerificationURI: prov.LoginURL,
		Interval:        5,
		ExpiresAt:       time.Now().Add(10 * time.Minute),
	})

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":           "pending",
		"device_code":      deviceCode,
		"user_code":        userCode,
		"verification_uri": prov.LoginURL,
		"interval":         5,
		"raw":              data,
	})
}

// initiateCodeBuddy fetches the auth state; the CLI/IDE scans it and polls.
// Platform travels as a query param (verified live): POST
// {stateUrl}?platform=CLI -> {data:{state, authUrl}}.
func initiateCodeBuddy(w http.ResponseWriter, prov *OAuthProvider) {
	platform := "CLI"
	if p, ok := prov.Headers["X-IDE-Type"]; ok && p != "" {
		platform = p
	}
	stateEndpoint := prov.StateURL + "?platform=" + url.QueryEscape(platform)
	req, err := http.NewRequest(http.MethodPost, stateEndpoint, strings.NewReader("{}"))
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range prov.Headers {
		req.Header.Set(k, v)
	}

	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		WriteErrorResponse(w, http.StatusBadGateway, "CodeBuddy state request failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		WriteErrorResponse(w, resp.StatusCode, "CodeBuddy rejected state request: "+truncate(string(body), 300))
		return
	}

	var data struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			State   string `json:"state"`
			AuthURL string `json:"authUrl"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &data); err != nil || data.Code != 0 || data.Data.State == "" {
		WriteErrorResponse(w, http.StatusBadGateway, "Cannot parse CodeBuddy state: "+truncate(string(body), 200))
		return
	}

	storePending(prov.ID, &pendingDeviceAuth{
		Provider:        prov.ID,
		DeviceCode:      data.Data.State,
		VerificationURI: data.Data.AuthURL,
		Interval:        prov.PollIntervalS,
		ExpiresAt:       time.Now().Add(10 * time.Minute),
		Extra:           map[string]string{"platform": platform},
	})

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":           "pending",
		"state":            data.Data.State,
		"verification_uri": data.Data.AuthURL,
		"interval":         prov.PollIntervalS,
	})
}

// handleOAuthPoll exchanges the pending device code for tokens, then persists
// the connection. Polling is idempotent: a successful poll clears the pending
// entry, later polls report "expired".
func handleOAuthPoll(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	providerID := providerFromPath(r.URL.Path, "/poll")
	prov, ok := oauthProviderFor(providerID)
	if !ok {
		WriteErrorResponse(w, http.StatusNotFound, fmt.Sprintf("Unknown OAuth provider %q", providerID))
		return
	}

	pending := takePending(prov.ID)
	if pending == nil {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "expired", "message": "No pending login — initiate again."})
		return
	}
	if time.Now().After(pending.ExpiresAt) {
		clearPending(prov.ID)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "expired", "message": "Device code expired."})
		return
	}

	var tokens oauthTokens
	var err error
	switch prov.Flow {
	case "qoder":
		tokens, err = pollQoder(prov, pending)
	case "codebuddy":
		tokens, err = pollCodeBuddy(prov, pending)
	default:
		tokens, err = pollDeviceFlow(prov, pending)
	}
	if err != nil {
		// still pending upstream — tell the UI to keep polling
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "authorization_pending", "message": err.Error()})
		return
	}

	clearPending(prov.ID)
	if err := saveOAuthConnection(prov, tokens); err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, "Saving connection: "+err.Error())
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "success",
		"email":  tokens.Email,
		"provider": prov.ID,
	})
}

type oauthTokens struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int
	Email        string
	OrgID        string
}

// pollDeviceFlow does one RFC 8628 token exchange (form-encoded).
func pollDeviceFlow(prov *OAuthProvider, pending *pendingDeviceAuth) (oauthTokens, error) {
	form := url.Values{}
	form.Set("client_id", prov.ClientID)
	form.Set("device_code", pending.DeviceCode)
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")

	req, _ := http.NewRequest(http.MethodPost, prov.TokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", userAgentFor(prov.ID))

	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return oauthTokens{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return oauthTokens{}, fmt.Errorf("unparsable token response: %s", truncate(string(body), 200))
	}
	if e, _ := data["error"].(string); e != "" {
		desc, _ := data["error_description"].(string)
		if e == "authorization_pending" || e == "slow_down" {
			return oauthTokens{}, fmt.Errorf("authorization pending")
		}
		return oauthTokens{}, fmt.Errorf("%s: %s", e, desc)
	}

	access, _ := data["access_token"].(string)
	if access == "" {
		return oauthTokens{}, fmt.Errorf("no access_token in response")
	}
	refresh, _ := data["refresh_token"].(string)
	expires := 0
	if v, ok := data["expires_in"].(float64); ok {
		expires = int(v)
	}

	tok := oauthTokens{AccessToken: access, RefreshToken: refresh, ExpiresIn: expires}

	// Copilot: exchange the GitHub token for a short-lived Copilot token.
	if prov.CopilotTokenURL != "" {
		copilotTok, org, err := fetchCopilotToken(prov, access)
		if err != nil {
			return oauthTokens{}, err
		}
		tok.AccessToken = copilotTok
		tok.OrgID = org
	}

	tok.Email = fetchOAuthEmail(prov, tok.AccessToken)
	return tok, nil
}

// fetchCopilotToken swaps a GitHub OAuth token for a Copilot bearer token.
func fetchCopilotToken(prov *OAuthProvider, githubToken string) (string, string, error) {
	req, _ := http.NewRequest(http.MethodGet, prov.CopilotTokenURL, nil)
	req.Header.Set("Authorization", "token "+githubToken)
	req.Header.Set("User-Agent", "GitHubCopilotChat/0.26.7")
	req.Header.Set("Editor-Version", "vscode/1.85.0")
	req.Header.Set("Editor-Plugin-Version", "copilot-chat/0.26.7")

	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return "", "", fmt.Errorf("copilot token exchange failed (HTTP %d): %s", resp.StatusCode, truncate(string(body), 200))
	}
	var data struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(body, &data); err != nil || data.Token == "" {
		return "", "", fmt.Errorf("no copilot token in response")
	}
	return data.Token, "", nil
}

func pollQoder(prov *OAuthProvider, pending *pendingDeviceAuth) (oauthTokens, error) {
	payload, _ := json.Marshal(map[string]interface{}{"device_code": pending.DeviceCode, "deviceCode": pending.DeviceCode})
	resp, err := http.Post(prov.PollURL, "application/json", strings.NewReader(string(payload)))
	if err != nil {
		return oauthTokens{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return oauthTokens{}, fmt.Errorf("unparsable qoder response: %s", truncate(string(body), 200))
	}
	// Qoder reports progress states rather than OAuth errors.
	if st, _ := data["status"].(string); st != "" && st != "success" && st != "authorized" {
		return oauthTokens{}, fmt.Errorf("qoder status: %s", st)
	}
	token, _ := data["token"].(string)
	if token == "" {
		token, _ = data["access_token"].(string)
	}
	if token == "" {
		token, _ = data["jobToken"].(string)
	}
	if token == "" {
		return oauthTokens{}, fmt.Errorf("qoder authorization pending")
	}
	refresh, _ := data["refresh_token"].(string)
	email, _ := data["email"].(string)
	expires := 86400
	if v, ok := data["expires_in"].(float64); ok {
		expires = int(v)
	}
	return oauthTokens{AccessToken: token, RefreshToken: refresh, ExpiresIn: expires, Email: email}, nil
}

func pollCodeBuddy(prov *OAuthProvider, pending *pendingDeviceAuth) (oauthTokens, error) {
	platform := "CLI"
	if pending.Extra != nil && pending.Extra["platform"] != "" {
		platform = pending.Extra["platform"]
	}
	tokenURL := prov.TokenURL + "?platform=" + url.QueryEscape(platform)
	payload, _ := json.Marshal(map[string]interface{}{"state": pending.DeviceCode})
	req, _ := http.NewRequest(http.MethodPost, tokenURL, strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range prov.Headers {
		req.Header.Set(k, v)
	}

	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return oauthTokens{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return oauthTokens{}, fmt.Errorf("unparsable codebuddy response: %s", truncate(string(body), 200))
	}
	// Unapproved state usually returns a non-null error or an empty token.
	if e, _ := data["error"].(string); e != "" {
		return oauthTokens{}, fmt.Errorf("codebuddy: %s", e)
	}
	token, _ := data["accessToken"].(string)
	if token == "" {
		token, _ = data["access_token"].(string)
	}
	if token == "" {
		token, _ = data["token"].(string)
	}
	if token == "" {
		return oauthTokens{}, fmt.Errorf("codebuddy authorization pending")
	}
	refresh, _ := data["refreshToken"].(string)
	if refresh == "" {
		refresh, _ = data["refresh_token"].(string)
	}
	email, _ := data["email"].(string)
	expires := 3600
	if v, ok := data["expiresIn"].(float64); ok {
		expires = int(v)
	}
	return oauthTokens{AccessToken: token, RefreshToken: refresh, ExpiresIn: expires, Email: email}, nil
}

// fetchOAuthEmail best-effort resolves the account email for display. Failure
// is non-fatal: the connection still works without a label.
func fetchOAuthEmail(prov *OAuthProvider, token string) string {
	var endpoint, header, scheme string
	switch prov.ID {
	case "copilot":
		endpoint, header, scheme = "https://api.github.com/user", "Authorization", "token "
	case "xai", "grok-cli":
		endpoint, header, scheme = "https://api.x.ai/v1/user", "Authorization", "Bearer "
	default:
		return ""
	}

	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return ""
	}
	req.Header.Set(header, scheme+token)
	req.Header.Set("User-Agent", userAgentFor(prov.ID))
	req.Header.Set("Accept", "application/json")

	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return ""
	}
	var data map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return ""
	}
	for _, key := range []string{"email", "login", "username", "name"} {
		if v, ok := data[key].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

func userAgentFor(provider string) string {
	switch provider {
	case "copilot":
		return "GitHubCopilotChat/0.26.7"
	case "grok-cli":
		return "grok-shell/0.2.99 (linux; x86_64)"
	case "codebuddy":
		return "IDE/2.108.1 CodeBuddy/2.108.1"
	case "codebuddy-cn":
		return "CLI/2.108.1 CodeBuddy/2.108.1"
	default:
		return "myairouter/1.0"
	}
}

// saveOAuthConnection creates (or refreshes) the provider connection holding
// the freshly minted tokens.
func saveOAuthConnection(prov *OAuthProvider, tok oauthTokens) error {
	now := time.Now().UTC().Format(time.RFC3339)
	connID := prov.ID + "-oauth"

	expiresAt := ""
	if tok.ExpiresIn > 0 {
		expiresAt = time.Now().UTC().Add(time.Duration(tok.ExpiresIn) * time.Second).Format(time.RFC3339)
	}

	name := prov.Name
	if tok.Email != "" {
		name = fmt.Sprintf("%s (%s)", prov.Name, tok.Email)
	}

	data := map[string]interface{}{
		"apiKey":       tok.AccessToken,
		"refreshToken": tok.RefreshToken,
		"expiresAt":    expiresAt,
		"authType":     "oauth",
		"oauthProvider": prov.ID,
	}
	if prov.BaseURL != "" {
		data["baseUrl"] = prov.BaseURL
	}
	if tok.OrgID != "" {
		data["orgId"] = tok.OrgID
	}

	conn := &db.ProviderConnection{
		ID:        connID,
		Provider:  prov.ID,
		AuthType:  "oauth",
		Name:      name,
		Email:     tok.Email,
		Priority:  1,
		IsActive:  true,
		CreatedAt: now,
		UpdatedAt: now,
		Data:      data,
	}

	if _, err := db.CreateConnection(conn); err != nil {
		// Refresh the existing connection instead of failing on duplicates.
		cur, gerr := db.GetConnection(connID)
		if gerr != nil {
			return err // genuinely new — surface the insert error
		}
		for k, v := range data {
			cur.Data[k] = v
		}
		_, err = db.UpdateConnection(connID, map[string]interface{}{
			"name":     conn.Name,
			"email":    conn.Email,
			"isActive": true,
			"data":     cur.Data,
		})
		return err
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
