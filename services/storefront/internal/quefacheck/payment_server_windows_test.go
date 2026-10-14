package quefacheck

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"gptibo/storefront/internal/recharge"
)

const paymentFixtureSecret = "fixture_independent_one_cny_webhook_secret"
const paymentFixtureAPISecret = "fixture_one_cny_API_client_secret_only"

type paymentFixture struct {
	server                   *PaymentTestServer
	order                    paymentTestOrder
	code                     paymentTestCode
	calls, creates, codes    int
	createBodies, createKeys []string
	failFirst                bool
}

func newPaymentFixture(t *testing.T) *paymentFixture {
	t.Helper()
	root := t.TempDir()
	creds := filepath.Join(root, "credentials")
	directory := filepath.Join(root, "payment")
	store, err := NewServer("https://supplier.example.test/v1", creds, "http://127.0.0.1:8769")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.save(Credentials{"pt_fixture", "key_fixture", paymentFixtureAPISecret}); err != nil {
		t.Fatal(err)
	}
	s, err := NewPaymentTestServer(store.base, creds, directory, store.origin)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(directory, "callback.json"), []byte(`{"notify_url":"https://callback.example.test/api/recharge/webhook"}`), 0600); err != nil {
		t.Fatal(err)
	}
	f := &paymentFixture{server: s, order: paymentTestOrder{ID: "ord_fixture_one_cny", Merchant: s.state.Merchant, Purpose: "payment_test", Product: "payment_test_1_cny", Quantity: 1, Sale: "1.00", Supply: "0.00", Margin: "0.00", Currency: "CNY", Collection: "platform_collect", Scope: "retail", Payment: "pending", Expires: time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339)}}
	var imageBytes bytes.Buffer
	if err = png.Encode(&imageBytes, image.NewGray(image.Rect(0, 0, 21, 21))); err != nil {
		t.Fatal(err)
	}
	f.code = paymentTestCode{ID: f.order.ID, Merchant: f.order.Merchant, Amount: "1.00", Currency: "CNY", Payment: "pending", Type: "alipay_precreate", Code: "https://qr.alipay.com/FixtureOneCny123", Image: "data:image/png;base64," + base64.StdEncoding.EncodeToString(imageBytes.Bytes()), Expires: f.order.Expires}
	f.attach(t, s)
	return f
}
func (f *paymentFixture) attach(t *testing.T, s *PaymentTestServer) {
	t.Helper()
	f.server = s
	s.transport = transportFunc(func(r *http.Request) (*http.Response, error) {
		f.calls++
		raw, _ := io.ReadAll(r.Body)
		if r.URL.Host != "supplier.example.test" || r.Header.Get("X-Partner-Id") != "pt_fixture" || r.Header.Get("X-Signature") != recharge.Signature(paymentFixtureAPISecret, r.Method, r.URL, r.Header.Get("X-Timestamp"), r.Header.Get("X-Nonce"), "key_fixture", r.Header.Get("Idempotency-Key"), string(raw)) {
			t.Fatal("supplier signature or destination mismatch")
		}
		var data any
		switch {
		case r.Method == "POST" && r.URL.Path == "/v1/webhooks/test":
			if len(raw) != 0 {
				t.Fatal("unexpected test-event body")
			}
			data = map[string]string{"event_id": "evt_fixture_probe", "status": "queued"}
		case r.Method == "POST" && r.URL.Path == "/v1/payment-tests":
			f.creates++
			f.createBodies = append(f.createBodies, string(raw))
			f.createKeys = append(f.createKeys, r.Header.Get("Idempotency-Key"))
			var fields map[string]any
			_ = json.Unmarshal(raw, &fields)
			if len(fields) != 2 || fields["merchant_order_no"] != f.order.Merchant || fields["notify_url"] != "https://callback.example.test/api/recharge/webhook" {
				t.Fatal("test order request shape changed")
			}
			if f.failFirst && f.creates == 1 {
				return nil, errors.New("fixture transport uncertainty")
			}
			data = f.order
		case r.Method == "POST" && r.URL.Path == "/v1/orders/"+f.order.ID+"/payment-code":
			f.codes++
			if string(raw) != "{}" {
				t.Fatal("unexpected payment code body")
			}
			data = f.code
		case r.Method == "GET" && r.URL.Path == "/v1/orders/"+f.order.ID:
			data = f.order
		default:
			t.Fatal("unexpected supplier operation", r.Method, r.URL.Path)
		}
		body, _ := json.Marshal(map[string]any{"data": data})
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(body))}, nil
	})
}
func (f *paymentFixture) ready(t *testing.T) {
	t.Helper()
	if err := f.server.configure(paymentFixtureSecret); err != nil {
		t.Fatal(err)
	}
	if err := f.server.testNotification(context.Background()); err != nil {
		t.Fatal(err)
	}
	if w := paymentNotice(f.server, "webhook.test", "evt_fixture_probe", `{"event_id":"evt_fixture_probe","event":"webhook.test"}`, nil); w.Code != 204 {
		t.Fatal("test notification rejected", w.Code)
	}
}
func paymentNotice(s *PaymentTestServer, kind, event, body string, change func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "http://127.0.0.1:8770/api/recharge/webhook", strings.NewReader(body))
	stamp := strconv.FormatInt(time.Now().Unix(), 10)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Quefa-Event", kind)
	r.Header.Set("X-Quefa-Event-Id", event)
	r.Header.Set("X-Quefa-Delivery", "dlv_fixture")
	r.Header.Set("X-Quefa-Timestamp", stamp)
	r.Header.Set("X-Quefa-Signature", "t="+stamp+",v1="+recharge.HMAC(paymentFixtureSecret, stamp+"."+body))
	if change != nil {
		change(r)
	}
	w := httptest.NewRecorder()
	s.WebhookHandler().ServeHTTP(w, r)
	return w
}
func paymentLocal(s *PaymentTestServer, method, path, body string, change func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, s.local.origin+path, strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:40000"
	r.Header.Set("X-Check-Token", s.local.token)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", s.local.origin)
	if change != nil {
		change(r)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}

func TestOneCnyLocalControlAndNoImplicitSupplierCalls(t *testing.T) {
	f := newPaymentFixture(t)
	s := f.server
	for _, tc := range []struct {
		name, method, path, body string
		change                   func(*http.Request)
		status                   int
	}{
		{"page", "GET", "/", "", nil, 200}, {"status", "GET", "/status", "", nil, 200},
		{"wrong host", "GET", "/", "", func(r *http.Request) { r.Host = "outside.example.test" }, 403},
		{"outside client", "GET", "/", "", func(r *http.Request) { r.RemoteAddr = "192.0.2.1:4000" }, 403},
		{"no token", "GET", "/status", "", func(r *http.Request) { r.Header.Del("X-Check-Token") }, 403},
		{"cross origin", "POST", "/create", "{}", func(r *http.Request) { r.Header.Set("Origin", "https://outside.example.test") }, 403},
		{"unknown input", "POST", "/create", `{"amount":"139.00"}`, nil, 400},
		{"second JSON", "POST", "/create", "{}{}", nil, 400},
		{"query rejected", "GET", "/status?secret=fixture", "", nil, 404},
		{"no configuration", "POST", "/create", "{}", nil, 503},
		{"no recharge route", "POST", "/redemptions", "{}", nil, 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := paymentLocal(s, tc.method, tc.path, tc.body, tc.change)
			if w.Code != tc.status {
				t.Fatal(w.Code)
			}
			if strings.Contains(w.Body.String(), paymentFixtureAPISecret) || strings.Contains(w.Body.String(), paymentFixtureSecret) {
				t.Fatal("secret exposed")
			}
		})
	}
	if f.calls != 0 {
		t.Fatal("supplier called without a valid explicit action")
	}
	if err := s.configure(paymentFixtureAPISecret); err == nil {
		t.Fatal("API secret accepted as webhook secret")
	}
	if err := s.configure(paymentFixtureSecret); err != nil {
		t.Fatal(err)
	}
	if err := s.create(context.Background()); err == nil || f.creates != 0 {
		t.Fatal("payment created before new callback proof")
	}
}

func TestOneCnySingleOrderRecoveryAndPaymentProof(t *testing.T) {
	f := newPaymentFixture(t)
	f.ready(t)
	s := f.server
	if err := s.create(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.creates != 1 || f.codes != 1 || s.view()["qr_image_data_url"] == nil {
		t.Fatal("valid bound QR not available")
	}
	if err := s.create(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.creates != 1 || f.codes != 1 {
		t.Fatal("duplicate create opened another order or code")
	}
	if err := s.configure("another_fixture_webhook_secret"); err == nil {
		t.Fatal("callback changed after order was attempted")
	}
	paidBody := `{"event":"order.paid","data":{"order_id":"` + f.order.ID + `","merchant_order_no":"` + f.order.Merchant + `","sale_amount":"1.00","currency":"CNY"}}`
	before := f.calls
	if w := paymentNotice(s, "order.paid", "evt_paid", paidBody, nil); w.Code != 204 {
		t.Fatal(w.Code)
	}
	if f.calls != before || s.view()["passed"] != false || s.view()["qr_image_data_url"] != nil {
		t.Fatal("notification alone marked paid or invoked supplier")
	}
	f.order.Payment = "paid"
	s.lastQuery = time.Time{}
	if err := s.refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	if s.view()["passed"] != true {
		t.Fatal("paid query plus signed callback did not pass")
	}
	for _, path := range []string{filepath.Join(s.local.directory, "one-cny-state.dpapi"), filepath.Join(s.local.directory, "webhook-secret.dpapi")} {
		raw, _ := os.ReadFile(path)
		if bytes.Contains(raw, []byte(paymentFixtureSecret)) || bytes.Contains(raw, []byte("qr.alipay.com")) {
			t.Fatal("plaintext private state persisted")
		}
	}
	restarted, err := NewPaymentTestServer(s.local.base, s.credentials.directory, s.local.directory, s.local.origin)
	if err != nil {
		t.Fatal(err)
	}
	f.attach(t, restarted)
	if restarted.view()["passed"] != true {
		t.Fatal("accepted payment lost on restart")
	}
	if w := paymentNotice(restarted, "order.paid", "evt_paid", paidBody, nil); w.Code != 204 {
		t.Fatal("duplicate rejected after restart", w.Code)
	}
	if w := paymentNotice(restarted, "order.paid", "evt_paid", paidBody+" ", nil); w.Code != 409 {
		t.Fatal("changed duplicate accepted", w.Code)
	}
	f.order.Payment = "pending"
	restarted.lastQuery = time.Time{}
	if err = restarted.refresh(context.Background()); err == nil || restarted.view()["payment_status"] != "paid" {
		t.Fatal("stale query regressed confirmed payment")
	}
	if f.creates != 1 {
		t.Fatal("more than one test order created")
	}
}

func TestOneCnyUnknownCreationReusesPersistedBusinessIdentity(t *testing.T) {
	f := newPaymentFixture(t)
	f.ready(t)
	f.failFirst = true
	s := f.server
	if err := s.create(context.Background()); err == nil {
		t.Fatal("uncertain response accepted")
	}
	if !s.state.Attempted || s.state.Order != nil {
		t.Fatal("uncertain attempt not preserved")
	}
	restarted, err := NewPaymentTestServer(s.local.base, s.credentials.directory, s.local.directory, s.local.origin)
	if err != nil {
		t.Fatal(err)
	}
	f.attach(t, restarted)
	if err = restarted.create(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.creates != 2 || f.createBodies[0] != f.createBodies[1] || f.createKeys[0] != f.createKeys[1] {
		t.Fatal("recovery changed business identity")
	}
}

func TestOneCnyRejectsWrongPurposeAmountAndCode(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*paymentFixture)
	}{
		{"subscription", func(f *paymentFixture) { f.order.Purpose = "subscription" }},
		{"wrong product", func(f *paymentFixture) { f.order.Product = PlusCode }},
		{"wrong sale", func(f *paymentFixture) { f.order.Sale = "139.00" }},
		{"wrong currency", func(f *paymentFixture) { f.order.Currency = "USD" }},
		{"procurement", func(f *paymentFixture) { f.order.Scope = "procurement" }},
		{"agent collect", func(f *paymentFixture) { f.order.Collection = "agent_collect" }},
		{"commission", func(f *paymentFixture) { f.order.Margin = "0.10" }},
		{"supply charge", func(f *paymentFixture) { f.order.Supply = "110.00" }},
		{"fulfillment", func(f *paymentFixture) { v := "direct"; f.order.Fulfillment = &v }},
		{"voucher", func(f *paymentFixture) { v := "FIXTURE"; f.order.Voucher = &v }},
		{"wrong code amount", func(f *paymentFixture) { f.code.Amount = "2.00" }},
		{"wrong code order", func(f *paymentFixture) { f.code.ID = "ord_other" }},
		{"wrong code host", func(f *paymentFixture) { f.code.Code = "https://outside.example.test/FixtureOneCny123" }},
		{"wrong image format", func(f *paymentFixture) { f.code.Image = "data:image/svg+xml;base64,ZmFrZQ==" }},
		{"invalid PNG", func(f *paymentFixture) { f.code.Image = "data:image/png;base64,ZmFrZQ==" }},
		{"wrong expiry", func(f *paymentFixture) { f.code.Expires = time.Now().Add(20 * time.Minute).UTC().Format(time.RFC3339) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newPaymentFixture(t)
			f.ready(t)
			tc.mutate(f)
			if err := f.server.create(context.Background()); err == nil {
				t.Fatal("unsafe order/code accepted")
			}
			if f.server.view()["qr_image_data_url"] != nil {
				t.Fatal("unsafe QR displayed")
			}
		})
	}
}

func TestOneCnyWebhookBoundaryAndBusinessBinding(t *testing.T) {
	f := newPaymentFixture(t)
	f.ready(t)
	s := f.server
	if err := s.create(context.Background()); err != nil {
		t.Fatal(err)
	}
	valid := `{"data":{"order_id":"` + f.order.ID + `"}}`
	for _, tc := range []struct {
		name, kind, body string
		change           func(*http.Request)
		status           int
	}{
		{"valid bound paid", "order.paid", valid, nil, 204},
		{"missing signature", "order.paid", valid, func(r *http.Request) { r.Header.Del("X-Quefa-Signature") }, 401},
		{"invalid signature", "order.paid", valid, func(r *http.Request) { r.Header.Set("X-Quefa-Signature", "bad") }, 401},
		{"old timestamp", "order.paid", valid, func(r *http.Request) { r.Header.Set("X-Quefa-Timestamp", "1000000000") }, 401},
		{"duplicate header", "order.paid", valid, func(r *http.Request) { r.Header.Add("X-Quefa-Event-Id", "other") }, 401},
		{"wrong order", "order.paid", `{"data":{"order_id":"ord_other"}}`, nil, 403},
		{"no order", "order.paid", `{}`, nil, 403},
		{"wrong amount", "order.paid", `{"data":{"order_id":"` + f.order.ID + `","sale_amount":"2.00"}}`, nil, 403},
		{"conflicting identity", "order.paid", `{"order_id":"ord_other","data":{"order_id":"` + f.order.ID + `"}}`, nil, 400},
		{"wrong event envelope", "order.paid", `{"event":"order.closed"}`, nil, 400},
		{"fulfillment rejected", "fulfillment.succeeded", valid, nil, 403},
		{"refund rejected", "refund.succeeded", valid, nil, 403},
		{"GET rejected", "order.paid", valid, func(r *http.Request) { r.Method = "GET" }, 404},
		{"control not exposed", "order.paid", valid, func(r *http.Request) { r.URL.Path = "/status" }, 404},
		{"query rejected", "order.paid", valid, func(r *http.Request) { r.URL.RawQuery = "x=1" }, 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := paymentNotice(s, tc.kind, "evt_"+strings.ReplaceAll(tc.name, " ", "_"), tc.body, tc.change)
			if w.Code != tc.status {
				t.Fatal(w.Code)
			}
		})
	}
	if s.view()["passed"] != false {
		t.Fatal("webhook tests marked upstream query paid")
	}
	for i := 0; i < 60; i++ {
		_ = paymentNotice(s, "webhook.test", "evt_rate", `{}`, nil)
	}
	if w := paymentNotice(s, "webhook.test", "evt_rate", `{}`, nil); w.Code != 429 {
		t.Fatal("rate guard missing", w.Code)
	}
}

func TestOneCnyNetworkAndStateIsolation(t *testing.T) {
	f := newPaymentFixture(t)
	f.ready(t)
	s := f.server
	empty := "{}"
	for _, tc := range []struct {
		path string
		body *string
		key  string
	}{
		{"/orders", &empty, "fixture_other_key"}, {"/redemptions", &empty, "fixture_other_key"}, {"/refunds", &empty, "fixture_other_key"},
		{"/orders/ord_other", nil, ""}, {"/payment-tests", &empty, s.state.CreateKey}, {"/webhooks/test", &empty, s.state.TestKey},
	} {
		before := f.calls
		if err := s.request(context.Background(), tc.path, tc.body, tc.key, &map[string]any{}); err == nil || f.calls != before {
			t.Fatal("unapproved supplier request escaped")
		}
	}
	if err := s.create(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := s.local.saveWebhookSecret("changed_fixture_independent_secret"); err != nil {
		t.Fatal(err)
	}
	if s.view()["secret_saved"] != false || s.view()["qr_image_data_url"] != nil {
		t.Fatal("old callback proof reused after key change")
	}
	if err := os.WriteFile(filepath.Join(s.local.directory, "one-cny-state.dpapi"), []byte("corrupt fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewPaymentTestServer(s.local.base, s.credentials.directory, s.local.directory, s.local.origin); err == nil {
		t.Fatal("corrupt existing state silently reset")
	}
}

func TestOneCnyRejectsEmptyStateAndMidRunAccountSwitch(t *testing.T) {
	t.Run("empty existing state", func(t *testing.T) {
		f := newPaymentFixture(t)
		s := f.server
		if err := os.WriteFile(filepath.Join(s.local.directory, "one-cny-state.dpapi"), nil, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := NewPaymentTestServer(s.local.base, s.credentials.directory, s.local.directory, s.local.origin); err == nil {
			t.Fatal("empty existing state was reset")
		}
	})
	t.Run("account changed", func(t *testing.T) {
		f := newPaymentFixture(t)
		f.ready(t)
		s := f.server
		if err := s.credentials.save(Credentials{"pt_different_fixture", "key_fixture", paymentFixtureAPISecret}); err != nil {
			t.Fatal(err)
		}
		before := f.calls
		if err := s.testNotification(context.Background()); err == nil || f.calls != before {
			t.Fatal("switched supplier account was used")
		}
	})
}

func TestOneCnyPreflightSecretCorrectionKeepsSinglePaymentIdentity(t *testing.T) {
	f := newPaymentFixture(t)
	f.ready(t)
	s := f.server
	probe, create, merchant := s.state.TestKey, s.state.CreateKey, s.state.Merchant
	if err := s.configure("corrected_fixture_independent_webhook_secret"); err != nil {
		t.Fatal(err)
	}
	if s.state.TestKey == probe || s.state.TestNotice != nil || s.state.CreateKey != create || s.state.Merchant != merchant || s.state.Attempted {
		t.Fatal("secret correction did not isolate preflight from the single payment identity")
	}
}
