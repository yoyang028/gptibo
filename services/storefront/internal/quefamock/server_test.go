package quefamock

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"gptibo/storefront/internal/recharge"
	"gptibo/storefront/internal/security"
)

func fixture(t *testing.T) *server {
	t.Helper()
	return &server{directory: t.TempDir(), nonces: map[string]int64{}, data: state{Active: true, Orders: map[string]*record{}, Refunds: map[string]recharge.RemoteRefund{}, Replays: map[string]replay{}}}
}
func call(s *server, method, address, body, key string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "https://127.0.0.1:8766"+address, strings.NewReader(body))
	stamp, nonce := strconv.FormatInt(time.Now().Unix(), 10), security.ID()
	r.Header.Set("X-Partner-Id", Partner)
	r.Header.Set("X-Key-Id", Key)
	r.Header.Set("X-Timestamp", stamp)
	r.Header.Set("X-Nonce", nonce)
	r.Header.Set("Idempotency-Key", key)
	r.Header.Set("X-Signature", recharge.Signature(Secret, method, r.URL, stamp, nonce, Key, key, body))
	w := httptest.NewRecorder()
	s.api(w, r)
	return w
}
func TestMockRejectsUnsignedRequestsAndCrossOriginControls(t *testing.T) {
	s := fixture(t)
	r := httptest.NewRequest("GET", "https://127.0.0.1:8766/v1/products", nil)
	w := httptest.NewRecorder()
	s.api(w, r)
	if w.Code != 401 {
		t.Fatal("unsigned supplier request accepted")
	}
	s.data.Active = false
	r = httptest.NewRequest("POST", ControlOrigin+"/control", strings.NewReader(`{"action":"activate"}`))
	r.Header.Set("Origin", "https://outside.example.test")
	w = httptest.NewRecorder()
	s.control(w, r)
	if w.Code != 403 || s.data.Active {
		t.Fatal("cross-origin control mutation accepted")
	}
	if call(s, "GET", "/v1/products", "", "").Code != 403 {
		t.Fatal("suspended supplier accepted request")
	}
}
func TestMockRetryConfirmationIdempotencyAndCredentialDiscard(t *testing.T) {
	s := fixture(t)
	s.data.Orders["order"] = &record{Order: recharge.RemoteOrder{ID: "order", Payment: "paid"}, Tasks: []recharge.Redemption{}}
	body := `{"mode":"auto_recharge","order_id":"order","credential":{"mode":"access_token","access_token":"sensitive_fixture_not_saved"},"customer_confirmed_email":true}`
	if w := call(s, "POST", "/v1/redemptions", body, "recharge:attempt-1"); w.Code != 202 {
		t.Fatal("initial mock task rejected", w.Code)
	}
	if w := call(s, "POST", "/v1/redemptions", body, "recharge:attempt-1"); w.Code != 200 || len(s.data.Orders["order"].Tasks) != 1 {
		t.Fatal("same request created another task")
	}
	if w := call(s, "POST", "/v1/redemptions", body+" ", "recharge:attempt-1"); w.Code != 409 {
		t.Fatal("same key accepted different request bytes")
	}
	last := &s.data.Orders["order"].Tasks[0]
	last.Status = "failed"
	last.Retry = true
	last.Next = "resubmit"
	last.Paused = true
	retryBody := strings.TrimSuffix(body, "}") + `,"retry_confirmation":true}`
	if call(s, "POST", "/v1/redemptions", retryBody, "recharge:attempt-2").Code != 409 {
		t.Fatal("paused task accepted retry")
	}
	last.Paused = false
	if call(s, "POST", "/v1/redemptions", body, "recharge:attempt-2").Code != 409 {
		t.Fatal("new attempt accepted without manual confirmation")
	}
	if call(s, "POST", "/v1/redemptions", retryBody, "recharge:attempt-2").Code != 202 || len(s.data.Orders["order"].Tasks) != 2 {
		t.Fatal("confirmed new attempt rejected")
	}
	saved, err := os.ReadFile(filepath.Join(s.directory, "state.json"))
	if err != nil || strings.Contains(string(saved), "sensitive_fixture_not_saved") {
		t.Fatal("supplier fixture persisted customer credential", err)
	}
}
