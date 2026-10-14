package quefacheck

import (
	"crypto/hmac"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"gptibo/storefront/internal/recharge"
	"gptibo/storefront/internal/security"
)

type WebhookReceipt struct {
	ReceivedAt string `json:"received_at"`
	Event      string `json:"event"`
	EventHash  string `json:"event_hash"`
	BodyHash   string `json:"body_hash"`
	BodyBytes  int    `json:"body_bytes"`
	Duplicate  bool   `json:"duplicate"`
}

type webhookState struct {
	Base       string            `json:"api_base"`
	SecretHash string            `json:"secret_hash"`
	Events     map[string]string `json:"events"`
	Latest     *WebhookReceipt   `json:"latest"`
}

func validWebhookSecret(secret string) bool {
	return len(secret) >= 16 && len(secret) <= 4096 && strings.IndexFunc(secret, func(r rune) bool { return r <= ' ' || r > '~' }) < 0
}

func (s *Server) saveWebhookSecret(secret string) error {
	data, _ := json.Marshal(map[string]string{"api_base": s.base, "webhook_secret": secret})
	encrypted, err := protect(data, false)
	clear(data)
	if err != nil {
		return errors.New("webhook secret encryption failed")
	}
	return atomicWrite(filepath.Join(s.directory, "webhook-secret.dpapi"), encrypted)
}

func (s *Server) loadWebhookSecret() (string, error) {
	encrypted, err := os.ReadFile(filepath.Join(s.directory, "webhook-secret.dpapi"))
	if err != nil || len(encrypted) == 0 || len(encrypted) > 32768 {
		return "", errors.New("webhook secret is not configured")
	}
	data, err := protect(encrypted, true)
	if err != nil {
		return "", errors.New("webhook secret requires the same Windows user")
	}
	defer clear(data)
	var saved struct {
		Base   string `json:"api_base"`
		Secret string `json:"webhook_secret"`
	}
	if json.Unmarshal(data, &saved) != nil || saved.Base != s.base || !validWebhookSecret(saved.Secret) {
		return "", errors.New("webhook secret does not match this environment")
	}
	return saved.Secret, nil
}

func (s *Server) webhookState(secret string) webhookState {
	state := webhookState{Base: s.base, SecretHash: security.Hash(secret), Events: map[string]string{}}
	data, err := os.ReadFile(filepath.Join(s.directory, "webhook-test-result.json"))
	var saved webhookState
	if err == nil && len(data) < 64000 && json.Unmarshal(data, &saved) == nil && saved.Base == state.Base && saved.SecretHash == state.SecretHash && saved.Events != nil && len(saved.Events) <= 128 {
		return saved
	}
	return state
}

// This runs only behind the separate loopback test listener. It never handles
// business events or forwards requests to the shop, database or supplier API.
func (s *Server) WebhookTestHandler() http.Handler {
	return http.HandlerFunc(s.receiveWebhookTest)
}

func (s *Server) receiveWebhookTest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.URL.Path != "/api/recharge/webhook" || r.URL.RawPath != "" || r.URL.RawQuery != "" || r.Method != "POST" {
		http.NotFound(w, r)
		return
	}
	contentType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if contentType != "application/json" {
		http.Error(w, "JSON test notification required", 415)
		return
	}
	for _, header := range []string{"X-Quefa-Timestamp", "X-Quefa-Signature", "X-Quefa-Event-Id", "X-Quefa-Event", "X-Quefa-Delivery"} {
		if len(r.Header.Values(header)) != 1 {
			http.Error(w, "invalid notification headers", 401)
			return
		}
	}
	stamp, event, delivery := r.Header.Get("X-Quefa-Timestamp"), r.Header.Get("X-Quefa-Event-Id"), r.Header.Get("X-Quefa-Delivery")
	n, err := strconv.ParseInt(stamp, 10, 64)
	delta := time.Now().Unix() - n
	id := regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	if err != nil || len(stamp) != 10 || delta > 300 || delta < -300 || !id.MatchString(event) || !id.MatchString(delivery) {
		http.Error(w, "invalid notification identity or time", 401)
		return
	}
	if r.Header.Get("X-Quefa-Event") != "webhook.test" {
		http.Error(w, "test-only endpoint; business events are not accepted", 403)
		return
	}
	if !s.hookMu.TryLock() {
		w.Header().Set("Retry-After", "5")
		http.Error(w, "test receiver busy", 429)
		return
	}
	defer s.hookMu.Unlock()
	if time.Since(s.hookWindow) >= time.Minute {
		s.hookWindow, s.hookCount = time.Now(), 0
	}
	if s.hookCount >= 60 {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "test notification rate limit", 429)
		return
	}
	s.hookCount++
	secret, err := s.loadWebhookSecret()
	if err != nil {
		http.Error(w, "webhook test secret not configured", 503)
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64000))
	if err != nil || !utf8.Valid(raw) {
		http.Error(w, "invalid or oversized test notification", 400)
		return
	}
	defer clear(raw)
	want := "t=" + stamp + ",v1=" + recharge.HMAC(secret, stamp+"."+string(raw))
	if !hmac.Equal([]byte(want), []byte(r.Header.Get("X-Quefa-Signature"))) {
		http.Error(w, "notification signature rejected", 401)
		return
	}
	var payload map[string]any
	if json.Unmarshal(raw, &payload) != nil || payload == nil {
		http.Error(w, "invalid JSON notification", 400)
		return
	}
	for name, expected := range map[string]string{"event_id": event, "event": "webhook.test", "type": "webhook.test"} {
		if value, exists := payload[name]; exists && value != expected {
			http.Error(w, "notification identity mismatch", 400)
			return
		}
	}
	state := s.webhookState(secret)
	eventHash, bodyHash := security.Hash(event), security.Hash(string(raw))
	previous, duplicate := state.Events[eventHash]
	if duplicate && previous != bodyHash {
		http.Error(w, "test event identity conflict", 409)
		return
	}
	if !duplicate && len(state.Events) >= 128 {
		http.Error(w, "test receipt storage limit reached", 503)
		return
	}
	state.Events[eventHash] = bodyHash
	state.Latest = &WebhookReceipt{ReceivedAt: time.Now().UTC().Format(time.RFC3339), Event: "webhook.test", EventHash: eventHash, BodyHash: bodyHash, BodyBytes: len(raw), Duplicate: duplicate}
	data, _ := json.MarshalIndent(state, "", "  ")
	if atomicWrite(filepath.Join(s.directory, "webhook-test-result.json"), data) != nil {
		http.Error(w, "cannot persist test receipt", 500)
		return
	}
	w.WriteHeader(204)
}

// Both routes inherit the control server's loopback Host and CSRF checks.
func (s *Server) serveWebhookControl(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/webhook-status" && r.Method == "GET" {
		s.hookMu.Lock()
		defer s.hookMu.Unlock()
		secret, err := s.loadWebhookSecret()
		var receipt *WebhookReceipt
		if err == nil {
			receipt = s.webhookState(secret).Latest
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"secret_saved": err == nil, "test_only": true, "receipt": receipt})
		return
	}
	if r.URL.Path != "/webhook-secret" || r.Method != "POST" || r.Header.Get("Origin") != s.origin || r.Header.Get("Content-Type") != "application/json" {
		http.Error(w, "same-origin JSON required", 403)
		return
	}
	var input struct {
		Secret string `json:"webhook_secret"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF {
		http.Error(w, "invalid webhook secret input", 400)
		return
	}
	secret := strings.TrimSpace(input.Secret)
	api, _ := s.load()
	if !validWebhookSecret(secret) || secret == api.Secret {
		http.Error(w, "use the independent Webhook Secret, not the API client_secret", 400)
		return
	}
	s.hookMu.Lock()
	defer s.hookMu.Unlock()
	if s.saveWebhookSecret(secret) != nil {
		http.Error(w, "cannot encrypt and save webhook secret", 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"saved":true}`))
}
