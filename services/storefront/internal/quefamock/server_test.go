package quefamock

import (
	"encoding/json"
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

func TestCloudflareProfileKeepsOrderCallbacksAndControlsSeparate(t *testing.T) {
	s := fixture(t)
	s.cloudflare = true
	input := map[string]any{"merchant_order_no": "CF-LOCAL-001", "product_code": Product, "quantity": 1, "sale_amount": "139.00", "collection_mode": "platform_collect", "delivery_mode": "auto_recharge", "payment_channel": "alipay", "notify_url": Callback}
	wrong, _ := json.Marshal(input)
	if w := call(s, "POST", "/v1/orders", string(wrong), "order:cf-rejected"); w.Code != 400 {
		t.Fatal("Cloudflare fixture accepted another runtime callback", w.Code)
	}
	input["notify_url"] = "https://127.0.0.1:8771/api/recharge/webhook"
	raw, _ := json.Marshal(input)
	w := call(s, "POST", "/v1/orders", string(raw), "order:cf-accepted")
	if w.Code != 201 || !strings.Contains(w.Body.String(), "https://127.0.0.1:8773/payments/") {
		t.Fatal("isolated Cloudflare order rejected", w.Code)
	}
	r := httptest.NewRequest("POST", "http://127.0.0.1:8772/control", strings.NewReader(`{"action":"activate"}`))
	r.Header.Set("Origin", ControlOrigin)
	w = httptest.NewRecorder()
	s.control(w, r)
	if w.Code != 403 {
		t.Fatal("original simulator can mutate Cloudflare fixture")
	}
}

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
