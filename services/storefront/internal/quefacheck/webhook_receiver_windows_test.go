package quefacheck

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
)

const fixtureWebhookSecret = "independent_webhook_fixture_secret"

func TestWebhookTestReceiverRejectsUntrustedAndBusinessTraffic(t *testing.T) {
	server, err := NewServer("https://supplier.example.test/v1", t.TempDir(), "http://127.0.0.1:8767")
	if err != nil {
		t.Fatal(err)
	}
	if err := server.saveWebhookSecret(fixtureWebhookSecret); err != nil {
		t.Fatal(err)
	}
	body := `{"event_id":"evt_fixture","event":"webhook.test","data":{"message":"PRIVATE_TEST_PAYLOAD"}}`
	for _, name := range []string{"unsigned", "bad signature", "stale", "future", "signature timestamp mismatch", "invalid event ID", "duplicate header", "identity mismatch", "invalid JSON", "oversized", "bad UTF8", "business event", "control page path", "GET", "query parameters"} {
		t.Run(name, func(t *testing.T) {
			stamp := strconv.FormatInt(time.Now().Unix(), 10)
			value, event, secret, method, path := body, "webhook.test", fixtureWebhookSecret, "POST", "/api/recharge/webhook"
			want := 401
			switch name {
			case "bad signature":
				secret = "different_fixture_secret"
			case "stale":
				stamp = strconv.FormatInt(time.Now().Add(-10*time.Minute).Unix(), 10)
			case "future":
				stamp = strconv.FormatInt(time.Now().Add(10*time.Minute).Unix(), 10)
			case "identity mismatch":
				value = `{"event_id":"other_event","event":"webhook.test"}`
				want = 400
			case "invalid JSON":
				value = "null"
				want = 400
			case "oversized":
				value = strings.Repeat("x", 64001)
				want = 400
			case "bad UTF8":
				value = "\xff"
				want = 400
			case "business event":
				event = "order.paid"
				want = 403
			case "control page path":
				path = "/webhook-secret"
				want = 404
			case "GET":
				method = "GET"
				want = 404
			case "query parameters":
				path += "?debug=true"
				want = 404
			}
			r := httptest.NewRequest(method, "http://receiver.example.test"+path, strings.NewReader(value))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-Quefa-Timestamp", stamp)
			r.Header.Set("X-Quefa-Event-Id", "evt_fixture")
			r.Header.Set("X-Quefa-Event", event)
			r.Header.Set("X-Quefa-Delivery", "delivery_fixture")
			r.Header.Set("X-Quefa-Signature", "t="+stamp+",v1="+recharge.HMAC(secret, stamp+"."+value))
			switch name {
			case "unsigned":
				r.Header.Del("X-Quefa-Signature")
			case "signature timestamp mismatch":
				r.Header.Set("X-Quefa-Signature", strings.Replace(r.Header.Get("X-Quefa-Signature"), "t="+stamp, "t=1000000000", 1))
			case "invalid event ID":
				r.Header.Set("X-Quefa-Event-Id", "evt fixture")
			case "duplicate header":
				r.Header.Add("X-Quefa-Timestamp", stamp)
			}
			w := httptest.NewRecorder()
			server.WebhookTestHandler().ServeHTTP(w, r)
			if w.Code != want {
				t.Fatalf("expected %d, got %d: %s", want, w.Code, w.Body.String())
			}
			if strings.Contains(w.Body.String(), fixtureWebhookSecret) || strings.Contains(w.Body.String(), "PRIVATE_TEST_PAYLOAD") {
				t.Fatal("private value echoed")
			}
		})
	}
	if _, err := os.Stat(filepath.Join(server.directory, "webhook-test-result.json")); !os.IsNotExist(err) {
		t.Fatal("untrusted traffic created a receipt")
	}
}

func TestWebhookTestReceiptSurvivesRestartAndNeverStoresRawPayload(t *testing.T) {
	directory := t.TempDir()
	server, err := NewServer("https://supplier.example.test/v1", directory, "http://127.0.0.1:8767")
	if err != nil {
		t.Fatal(err)
	}
	if err := server.saveWebhookSecret(fixtureWebhookSecret); err != nil {
		t.Fatal(err)
	}
	post := func(server *Server, body string) *httptest.ResponseRecorder {
		stamp := strconv.FormatInt(time.Now().Unix(), 10)
		r := httptest.NewRequest("POST", "http://receiver.example.test/api/recharge/webhook", strings.NewReader(body))
		for key, value := range map[string]string{"Content-Type": "application/json; charset=utf-8", "X-Quefa-Timestamp": stamp, "X-Quefa-Event-Id": "evt_fixture", "X-Quefa-Event": "webhook.test", "X-Quefa-Delivery": "delivery_fixture", "X-Quefa-Signature": "t=" + stamp + ",v1=" + recharge.HMAC(fixtureWebhookSecret, stamp+"."+body)} {
			r.Header.Set(key, value)
		}
		w := httptest.NewRecorder()
		server.WebhookTestHandler().ServeHTTP(w, r)
		return w
	}
	body := `{"event_id":"evt_fixture","event":"webhook.test","data":{"message":"PRIVATE_TEST_PAYLOAD"}}`
	if w := post(server, body); w.Code != 204 {
		t.Fatal("signed test rejected", w.Code, w.Body.String())
	}
	if receipt := server.webhookState(fixtureWebhookSecret).Latest; receipt == nil || receipt.Duplicate {
		t.Fatal("first test not recorded")
	}
	server, err = NewServer("https://supplier.example.test/v1", directory, "http://127.0.0.1:8767")
	if err != nil {
		t.Fatal(err)
	}
	if w := post(server, body); w.Code != 204 {
		t.Fatal("duplicate rejected")
	}
	if receipt := server.webhookState(fixtureWebhookSecret).Latest; receipt == nil || !receipt.Duplicate {
		t.Fatal("duplicate not recognized after restart")
	}
	if w := post(server, strings.Replace(body, "PRIVATE_TEST_PAYLOAD", "changed", 1)); w.Code != 409 {
		t.Fatal("same event with different body accepted")
	}
	for _, name := range []string{"webhook-secret.dpapi", "webhook-test-result.json"} {
		data, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil || strings.Contains(string(data), fixtureWebhookSecret) || strings.Contains(string(data), "PRIVATE_TEST_PAYLOAD") || strings.Contains(string(data), "evt_fixture") {
			t.Fatal("private input persisted", name)
		}
	}
}

func TestWebhookSecretControlIsLocalEncryptedAndSeparateFromAPIKey(t *testing.T) {
	server, err := NewServer("https://supplier.example.test/v1", t.TempDir(), "http://127.0.0.1:8767")
	if err != nil {
		t.Fatal(err)
	}
	if err := server.save(Credentials{"pt_fixture", "key_fixture", "fixture_only_secret_for_checks"}); err != nil {
		t.Fatal(err)
	}
	request := func(method, path, origin, secret string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"webhook_secret": secret})
		r := httptest.NewRequest(method, server.origin+path, strings.NewReader(string(body)))
		r.RemoteAddr = "127.0.0.1:40000"
		r.Header.Set("X-Check-Token", server.token)
		r.Header.Set("Origin", origin)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		return w
	}
	if w := request("POST", "/webhook-secret", "https://outside.example.test", fixtureWebhookSecret); w.Code != 403 {
		t.Fatal("cross-origin secret update accepted")
	}
	if w := request("POST", "/webhook-secret", server.origin, "fixture_only_secret_for_checks"); w.Code != 400 {
		t.Fatal("API secret accepted as webhook secret")
	}
	if w := request("POST", "/webhook-secret", server.origin, fixtureWebhookSecret); w.Code != 200 || strings.Contains(w.Body.String(), fixtureWebhookSecret) {
		t.Fatal("webhook secret save failed or echoed")
	}
	if saved, err := server.loadWebhookSecret(); err != nil || saved != fixtureWebhookSecret {
		t.Fatal("webhook secret did not decrypt")
	}
	w := request("GET", "/webhook-status", server.origin, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"secret_saved":true`) || strings.Contains(w.Body.String(), fixtureWebhookSecret) {
		t.Fatal("unsafe webhook status")
	}
	server.base = "https://other.example.test/v1"
	if _, err := server.loadWebhookSecret(); err == nil {
		t.Fatal("webhook secret reused in a different environment")
	}
}

func TestWebhookReceiverLimitsSignatureAttempts(t *testing.T) {
	server, err := NewServer("https://supplier.example.test/v1", t.TempDir(), "http://127.0.0.1:8767")
	if err != nil {
		t.Fatal(err)
	}
	if err := server.saveWebhookSecret(fixtureWebhookSecret); err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 61; attempt++ {
		stamp := strconv.FormatInt(time.Now().Unix(), 10)
		r := httptest.NewRequest("POST", "http://receiver.example.test/api/recharge/webhook", strings.NewReader(`{}`))
		for key, value := range map[string]string{"Content-Type": "application/json", "X-Quefa-Timestamp": stamp, "X-Quefa-Event-Id": "evt_fixture", "X-Quefa-Event": "webhook.test", "X-Quefa-Delivery": "delivery_fixture", "X-Quefa-Signature": "bad"} {
			r.Header.Set(key, value)
		}
		w := httptest.NewRecorder()
		server.WebhookTestHandler().ServeHTTP(w, r)
		want := 401
		if attempt == 60 {
			want = 429
		}
		if w.Code != want {
			t.Fatal("signature rate limit failed", attempt, w.Code)
		}
	}
}
