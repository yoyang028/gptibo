package quefacheck

import (
	"crypto/hmac"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"slices"
	"strconv"
	"time"
	"unicode/utf8"

	"gptibo/storefront/internal/recharge"
	"gptibo/storefront/internal/security"
)

func (s *PaymentTestServer) WebhookHandler() http.Handler {
	return http.HandlerFunc(s.receivePaymentTestWebhook)
}

func (s *PaymentTestServer) receivePaymentTestWebhook(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != "POST" || r.URL.Path != "/api/recharge/webhook" || r.URL.RawPath != "" || r.URL.RawQuery != "" {
		http.NotFound(w, r)
		return
	}
	media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if media != "application/json" {
		http.Error(w, "JSON notification required", 415)
		return
	}
	for _, header := range []string{"X-Quefa-Event", "X-Quefa-Event-Id", "X-Quefa-Delivery", "X-Quefa-Timestamp", "X-Quefa-Signature"} {
		if len(r.Header.Values(header)) != 1 {
			http.Error(w, "invalid headers", 401)
			return
		}
	}
	stamp, event, delivery, kind := r.Header.Get("X-Quefa-Timestamp"), r.Header.Get("X-Quefa-Event-Id"), r.Header.Get("X-Quefa-Delivery"), r.Header.Get("X-Quefa-Event")
	n, err := strconv.ParseInt(stamp, 10, 64)
	delta := time.Now().Unix() - n
	if err != nil || len(stamp) != 10 || delta > 300 || delta < -300 || !paymentID.MatchString(event) || !paymentID.MatchString(delivery) {
		http.Error(w, "invalid notification identity or time", 401)
		return
	}
	if !slices.Contains([]string{"webhook.test", "order.paid", "order.expired", "order.closed"}, kind) {
		http.Error(w, "event outside payment-only test", 403)
		return
	}
	s.stateMu.Lock()
	if time.Since(s.hookWindow) >= time.Minute {
		s.hookWindow = time.Now()
		s.hookCount = 0
	}
	if s.hookCount >= 60 {
		s.stateMu.Unlock()
		w.Header().Set("Retry-After", "60")
		http.Error(w, "notification rate limit", 429)
		return
	}
	s.hookCount++
	s.stateMu.Unlock()
	secret, err := s.local.loadWebhookSecret()
	if err != nil {
		http.Error(w, "payment test webhook secret not configured", 503)
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64000))
	if err != nil || !utf8.Valid(raw) {
		http.Error(w, "invalid notification body", 400)
		return
	}
	defer clear(raw)
	want := "t=" + stamp + ",v1=" + recharge.HMAC(secret, stamp+"."+string(raw))
	if !hmac.Equal([]byte(want), []byte(r.Header.Get("X-Quefa-Signature"))) {
		http.Error(w, "signature rejected", 401)
		return
	}
	var payload map[string]any
	if json.Unmarshal(raw, &payload) != nil || payload == nil {
		http.Error(w, "invalid JSON", 400)
		return
	}
	for name, expected := range map[string]string{"event_id": event, "event": kind, "type": kind} {
		if value, exists := payload[name]; exists && value != expected {
			http.Error(w, "notification identity mismatch", 400)
			return
		}
	}
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if !s.secretReady() || security.Hash(secret) != s.state.SecretHash {
		http.Error(w, "callback environment changed", 409)
		return
	}
	if kind != "webhook.test" {
		if s.state.Order == nil {
			http.Error(w, "test order not bound yet", 409)
			return
		}
		var identity struct {
			Order    string `json:"order_id"`
			Merchant string `json:"merchant_order_no"`
			Data     struct {
				Order    string  `json:"order_id"`
				Merchant string  `json:"merchant_order_no"`
				Amount   *string `json:"sale_amount"`
				Currency *string `json:"currency"`
				Purpose  *string `json:"purpose"`
				Product  *string `json:"product_code"`
			} `json:"data"`
		}
		if json.Unmarshal(raw, &identity) != nil {
			http.Error(w, "invalid order identity", 400)
			return
		}
		order, merchant := identity.Data.Order, identity.Data.Merchant
		if order == "" {
			order = identity.Order
		} else if identity.Order != "" && identity.Order != order {
			http.Error(w, "conflicting order identity", 400)
			return
		}
		if merchant == "" {
			merchant = identity.Merchant
		} else if identity.Merchant != "" && identity.Merchant != merchant {
			http.Error(w, "conflicting merchant identity", 400)
			return
		}
		if order == "" && merchant == "" || order != "" && order != s.state.Order.ID || merchant != "" && merchant != s.state.Merchant || identity.Data.Amount != nil && *identity.Data.Amount != "1.00" || identity.Data.Currency != nil && *identity.Data.Currency != "CNY" || identity.Data.Purpose != nil && *identity.Data.Purpose != "payment_test" || identity.Data.Product != nil && *identity.Data.Product != "payment_test_1_cny" {
			http.Error(w, "notification belongs outside the single test order", 403)
			return
		}
	}
	eventHash, bodyHash := security.Hash(event), security.Hash(string(raw))
	previous, duplicate := s.state.Events[eventHash]
	if duplicate && previous != bodyHash {
		http.Error(w, "event identity conflict", 409)
		return
	}
	if !duplicate && len(s.state.Events) >= 128 {
		http.Error(w, "receipt limit reached", 503)
		return
	}
	oldEvents, oldTest, oldPaid := s.state.Events, s.state.TestNotice, s.state.PaidNotice
	s.state.Events = make(map[string]string, len(oldEvents)+1)
	for k, v := range oldEvents {
		s.state.Events[k] = v
	}
	s.state.Events[eventHash] = bodyHash
	receipt := &WebhookReceipt{ReceivedAt: time.Now().UTC().Format(time.RFC3339), Event: kind, EventHash: eventHash, BodyHash: bodyHash, BodyBytes: len(raw), Duplicate: duplicate}
	if kind == "webhook.test" {
		s.state.TestNotice = receipt
	}
	if kind == "order.paid" {
		s.state.PaidNotice = receipt
	}
	if err = s.save(); err != nil {
		s.state.Events, s.state.TestNotice, s.state.PaidNotice = oldEvents, oldTest, oldPaid
		http.Error(w, "cannot persist receipt", 500)
		return
	}
	w.WriteHeader(204)
}
