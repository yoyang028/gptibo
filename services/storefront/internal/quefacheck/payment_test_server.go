package quefacheck

import (
	"bytes"
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html/template"
	"image/png"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"gptibo/storefront/internal/recharge"
	"gptibo/storefront/internal/security"
)

//go:embed payment_test_page.html
var paymentTestPage string

var paymentID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type paymentTestOrder struct {
	ID                string  `json:"order_id"`
	Merchant          string  `json:"merchant_order_no"`
	Purpose           string  `json:"purpose"`
	Product           string  `json:"product_code"`
	Quantity          int     `json:"quantity"`
	Sale              string  `json:"sale_amount"`
	Supply            string  `json:"supply_amount"`
	Margin            string  `json:"merchant_margin"`
	Currency          string  `json:"currency"`
	Collection        string  `json:"collection_mode"`
	Scope             string  `json:"payment_scope"`
	Payment           string  `json:"payment_status"`
	Expires           string  `json:"expires_at"`
	Fulfillment       *string `json:"fulfillment_mode"`
	Delivery          *string `json:"delivery_mode"`
	FulfillmentURL    *string `json:"fulfillment_url"`
	Voucher           *string `json:"voucher_code"`
	FulfillmentStatus *string `json:"fulfillment_status"`
	Fallback          bool    `json:"fallback_recharge_available"`
}

type paymentTestCode struct {
	ID       string `json:"order_id"`
	Merchant string `json:"merchant_order_no"`
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
	Payment  string `json:"payment_status"`
	Type     string `json:"payment_code_type"`
	Code     string `json:"payment_code"`
	Image    string `json:"qr_image_data_url"`
	Expires  string `json:"expires_at"`
}

type paymentTestState struct {
	Base        string            `json:"api_base"`
	AccountHash string            `json:"account_hash"`
	Merchant    string            `json:"merchant_order_no"`
	CreateKey   string            `json:"create_key"`
	CodeKey     string            `json:"code_key"`
	TestKey     string            `json:"test_key"`
	Notify      string            `json:"notify_url"`
	SecretHash  string            `json:"secret_hash"`
	Attempted   bool              `json:"creation_attempted"`
	Order       *paymentTestOrder `json:"order,omitempty"`
	Code        *paymentTestCode  `json:"code,omitempty"`
	CheckedAt   string            `json:"checked_at,omitempty"`
	Events      map[string]string `json:"events"`
	TestNotice  *WebhookReceipt   `json:"test_notice,omitempty"`
	PaidNotice  *WebhookReceipt   `json:"paid_notice,omitempty"`
}

// PaymentTestServer has no database, subscription-order, recharge or refund access.
// Its separate executable is started only for the explicitly authorized one-CNY test.
type PaymentTestServer struct {
	credentials, local *Server
	stateMu, operation sync.Mutex
	state              paymentTestState
	transport          http.RoundTripper
	lastQuery          time.Time
	hookWindow         time.Time
	hookCount          int
}

func NewPaymentTestServer(base, credentialsDirectory, directory, origin string) (*PaymentTestServer, error) {
	credentials, err := NewServer(base, credentialsDirectory, origin)
	if err != nil {
		return nil, err
	}
	local, err := NewServer(base, directory, origin)
	if err != nil {
		return nil, err
	}
	keys, err := credentials.load()
	if err != nil {
		return nil, errors.New("saved supplier credentials are required")
	}
	s := &PaymentTestServer{credentials: credentials, local: local}
	accountHash := security.Hash(base + "\n" + keys.Partner)
	path := filepath.Join(directory, "one-cny-state.dpapi")
	cipher, err := os.ReadFile(path)
	if err == nil {
		if len(cipher) < 16 || len(cipher) > 512000 {
			return nil, errors.New("invalid payment test state")
		}
		plain, e := protect(cipher, true)
		if e != nil {
			return nil, errors.New("cannot decrypt existing payment test state")
		}
		defer clear(plain)
		if json.Unmarshal(plain, &s.state) != nil || s.state.Base != base || s.state.AccountHash != accountHash || !paymentID.MatchString(s.state.Merchant) || s.state.CreateKey == "" || s.state.CodeKey == "" || s.state.TestKey == "" || s.state.Events == nil || len(s.state.Events) > 128 {
			return nil, errors.New("existing payment test state does not match this account")
		}
	} else if os.IsNotExist(err) {
		var random [16]byte
		if _, err = rand.Read(random[:]); err != nil {
			return nil, err
		}
		id := hex.EncodeToString(random[:])
		s.state = paymentTestState{Base: base, AccountHash: accountHash, Merchant: "PT1-" + id, CreateKey: "pt1-create-" + id, CodeKey: "pt1-code-" + id, TestKey: "pt1-hook-" + id, Events: map[string]string{}}
		if err = s.save(); err != nil {
			return nil, err
		}
	} else {
		return nil, errors.New("cannot read existing payment test state")
	}
	return s, nil
}

func (s *PaymentTestServer) save() error {
	plain, err := json.Marshal(s.state)
	if err != nil {
		return err
	}
	defer clear(plain)
	cipher, err := protect(plain, false)
	if err != nil {
		return errors.New("cannot encrypt payment test state")
	}
	return atomicWrite(filepath.Join(s.local.directory, "one-cny-state.dpapi"), cipher)
}

func (s *PaymentTestServer) callbackURL() (string, error) {
	data, err := os.ReadFile(filepath.Join(s.local.directory, "callback.json"))
	if err != nil {
		return "", errors.New("temporary callback URL is not configured")
	}
	var config struct {
		URL string `json:"notify_url"`
	}
	if len(data) > 4096 || json.Unmarshal(data, &config) != nil {
		return "", errors.New("invalid callback configuration")
	}
	u, err := url.Parse(config.URL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "/api/recharge/webhook" || u.RawPath != "" || u.RawQuery != "" || u.Fragment != "" || u.Port() != "" || net.ParseIP(u.Hostname()) != nil || !strings.Contains(u.Hostname(), ".") || strings.HasSuffix(u.Hostname(), ".localhost") {
		return "", errors.New("a public HTTPS callback URL is required")
	}
	return config.URL, nil
}

// A final network guard binds each request to the exact approved method, path,
// body and idempotency key. No arbitrary supplier endpoint or proxy is usable.
type paymentTestTransport struct {
	base                   *url.URL
	method, path, raw, key string
	next                   http.RoundTripper
}

func (t paymentTestTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.Method != t.method || r.URL.Scheme != t.base.Scheme || r.URL.Host != t.base.Host || r.URL.Path != t.path || r.URL.RawPath != "" || r.URL.RawQuery != "" || r.URL.Fragment != "" || r.URL.User != nil || r.Header.Get("Idempotency-Key") != t.key {
		return nil, errors.New("payment test request rejected")
	}
	var raw []byte
	if r.Body != nil {
		var err error
		raw, err = io.ReadAll(io.LimitReader(r.Body, 8193))
		if err != nil {
			return nil, err
		}
	}
	if string(raw) != t.raw {
		return nil, errors.New("payment test body rejected")
	}
	if len(raw) > 0 {
		r.Body = io.NopCloser(bytes.NewReader(raw))
	} else {
		r.Body = http.NoBody
	}
	return t.next.RoundTrip(r)
}

func (s *PaymentTestServer) request(ctx context.Context, path string, body *string, key string, out any) error {
	s.stateMu.Lock()
	orderID := ""
	if s.state.Order != nil {
		orderID = s.state.Order.ID
	}
	merchant, notify, createKey, codeKey, testKey, accountHash := s.state.Merchant, s.state.Notify, s.state.CreateKey, s.state.CodeKey, s.state.TestKey, s.state.AccountHash
	s.stateMu.Unlock()
	createBody, _ := json.Marshal(struct {
		Merchant string `json:"merchant_order_no"`
		Notify   string `json:"notify_url"`
	}{merchant, notify})
	allowed := body != nil && (path == "/payment-tests" && key == createKey && *body == string(createBody) && notify != "" || path == "/webhooks/test" && key == testKey && *body == "" || orderID != "" && path == "/orders/"+orderID+"/payment-code" && *body == "{}" && key == codeKey) || body == nil && key == "" && orderID != "" && path == "/orders/"+orderID
	if !allowed {
		return errors.New("supplier endpoint is outside the one-CNY test")
	}
	keys, err := s.credentials.load()
	if err != nil {
		return errors.New("cannot load supplier credentials")
	}
	if security.Hash(s.local.base+"\n"+keys.Partner) != accountHash {
		return errors.New("supplier account changed during the single payment test")
	}
	client, err := recharge.NewClient(s.local.base, keys.Partner, keys.Key, keys.Secret)
	if err != nil {
		return err
	}
	direct := http.DefaultTransport.(*http.Transport).Clone()
	direct.Proxy = nil
	defer direct.CloseIdleConnections()
	next := s.transport
	if next == nil {
		next = direct
	}
	u, _ := url.Parse(client.Base)
	method, raw := "GET", ""
	if body != nil {
		method, raw = "POST", *body
	}
	client.HTTP.Transport = paymentTestTransport{u, method, "/v1" + path, raw, key, next}
	return client.Request(ctx, path, body, key, out)
}

func validateTestOrder(order paymentTestOrder, merchant, knownID string) error {
	_, expErr := time.Parse(time.RFC3339Nano, order.Expires)
	if !paymentID.MatchString(order.ID) || order.Merchant != merchant || knownID != "" && order.ID != knownID || order.Purpose != "payment_test" || order.Product != "payment_test_1_cny" || order.Quantity != 1 || order.Sale != "1.00" || order.Supply != "0.00" || order.Margin != "0.00" || order.Currency != "CNY" || order.Collection != "platform_collect" || order.Scope != "retail" || order.Fulfillment != nil || order.Delivery != nil || order.FulfillmentURL != nil || order.Voucher != nil || order.FulfillmentStatus != nil || order.Fallback || expErr != nil || !slices.Contains([]string{"pending", "paid", "expired", "closed", "refunded", "partially_refunded"}, order.Payment) {
		return errors.New("supplier response is not the bound one-CNY payment-only order")
	}
	return nil
}

func validateTestCode(code paymentTestCode, order paymentTestOrder) error {
	exp, e1 := time.Parse(time.RFC3339Nano, code.Expires)
	original, e2 := time.Parse(time.RFC3339Nano, order.Expires)
	u, e3 := url.Parse(code.Code)
	if code.ID != order.ID || code.Merchant != order.Merchant || code.Amount != "1.00" || code.Currency != "CNY" || code.Payment != "pending" || code.Type != "alipay_precreate" || e1 != nil || e2 != nil || !exp.Equal(original) || !exp.After(time.Now()) || e3 != nil || u.Scheme != "https" || u.Host != "qr.alipay.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !regexp.MustCompile(`^/[A-Za-z0-9]{8,128}$`).MatchString(u.Path) || !strings.HasPrefix(code.Image, "data:image/png;base64,") || len(code.Image) > 200000 {
		return errors.New("payment code binding failed")
	}
	image, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(code.Image, "data:image/png;base64,"))
	if err != nil {
		return errors.New("invalid payment code image")
	}
	config, err := png.DecodeConfig(bytes.NewReader(image))
	if err != nil || config.Width < 21 || config.Height < 21 || config.Width > 1024 || config.Height > 1024 {
		return errors.New("invalid payment code image dimensions")
	}
	return nil
}

func (s *PaymentTestServer) configure(secret string) error {
	if !s.operation.TryLock() {
		return errors.New("another operation is running")
	}
	defer s.operation.Unlock()
	notify, err := s.callbackURL()
	if err != nil {
		return err
	}
	keys, err := s.credentials.load()
	if err != nil {
		return err
	}
	if !validWebhookSecret(secret) || secret == keys.Secret {
		return errors.New("use the independent webhook secret")
	}
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if s.state.Attempted {
		return errors.New("callback cannot change after the single test order was attempted")
	}
	if err = s.local.saveWebhookSecret(secret); err != nil {
		return err
	}
	if s.state.Notify != notify || s.state.SecretHash != security.Hash(secret) {
		s.state.Notify, s.state.SecretHash = notify, security.Hash(secret)
		s.state.TestKey = "pt1-hook-" + security.ID()
		s.state.Events = map[string]string{}
		s.state.TestNotice = nil
		s.state.PaidNotice = nil
	}
	return s.save()
}

func (s *PaymentTestServer) testNotification(ctx context.Context) error {
	s.stateMu.Lock()
	ready := s.secretReady()
	key := s.state.TestKey
	s.stateMu.Unlock()
	if !ready {
		return errors.New("save the webhook secret first")
	}
	raw := ""
	var result struct {
		ID     string `json:"event_id"`
		Status string `json:"status"`
	}
	if err := s.request(ctx, "/webhooks/test", &raw, key, &result); err != nil {
		return err
	}
	if !paymentID.MatchString(result.ID) || result.Status != "queued" {
		return errors.New("invalid test event response")
	}
	return nil
}

// Called with stateMu held. The secret is never returned to the UI.
func (s *PaymentTestServer) secretReady() bool {
	secret, err := s.local.loadWebhookSecret()
	notify, notifyErr := s.callbackURL()
	return err == nil && notifyErr == nil && notify == s.state.Notify && s.state.SecretHash != "" && security.Hash(secret) == s.state.SecretHash
}

func (s *PaymentTestServer) create(ctx context.Context) error {
	s.stateMu.Lock()
	if !s.secretReady() || s.state.TestNotice == nil {
		s.stateMu.Unlock()
		return errors.New("verify the new callback before generating payment")
	}
	if s.state.Order != nil {
		s.stateMu.Unlock()
		return s.refresh(ctx)
	}
	s.state.Attempted = true
	if err := s.save(); err != nil {
		s.stateMu.Unlock()
		return err
	}
	merchant, notify, key := s.state.Merchant, s.state.Notify, s.state.CreateKey
	s.stateMu.Unlock()
	data, _ := json.Marshal(struct {
		Merchant string `json:"merchant_order_no"`
		Notify   string `json:"notify_url"`
	}{merchant, notify})
	raw := string(data)
	var order paymentTestOrder
	if err := s.request(ctx, "/payment-tests", &raw, key, &order); err != nil {
		return err
	}
	if err := validateTestOrder(order, merchant, ""); err != nil {
		return err
	}
	s.stateMu.Lock()
	s.state.Order = &order
	s.state.CheckedAt = time.Now().UTC().Format(time.RFC3339)
	err := s.save()
	s.stateMu.Unlock()
	if err != nil {
		return err
	}
	return s.code(ctx)
}

func (s *PaymentTestServer) code(ctx context.Context) error {
	s.stateMu.Lock()
	if s.state.Order == nil {
		s.stateMu.Unlock()
		return errors.New("no bound test order")
	}
	order, key := *s.state.Order, s.state.CodeKey
	if order.Payment != "pending" || s.state.Code != nil {
		s.stateMu.Unlock()
		return nil
	}
	s.stateMu.Unlock()
	exp, _ := time.Parse(time.RFC3339Nano, order.Expires)
	if !exp.After(time.Now()) {
		return nil
	}
	raw := "{}"
	var code paymentTestCode
	if err := s.request(ctx, "/orders/"+order.ID+"/payment-code", &raw, key, &code); err != nil {
		return err
	}
	if err := validateTestCode(code, order); err != nil {
		return err
	}
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	s.state.Code = &code
	return s.save()
}

func (s *PaymentTestServer) refresh(ctx context.Context) error {
	s.stateMu.Lock()
	if s.state.Order == nil {
		s.stateMu.Unlock()
		return nil
	}
	if time.Since(s.lastQuery) < 3*time.Second {
		s.stateMu.Unlock()
		return nil
	}
	s.lastQuery = time.Now()
	id, merchant, expires := s.state.Order.ID, s.state.Merchant, s.state.Order.Expires
	s.stateMu.Unlock()
	var order paymentTestOrder
	if err := s.request(ctx, "/orders/"+id, nil, "", &order); err != nil {
		return err
	}
	if err := validateTestOrder(order, merchant, id); err != nil {
		return err
	}
	if order.Expires != expires {
		return errors.New("order expiry changed during payment test")
	}
	s.stateMu.Lock()
	// A stale pending response may never regress an already confirmed payment.
	if s.state.Order.Payment == "paid" && !slices.Contains([]string{"paid", "refunded", "partially_refunded"}, order.Payment) {
		s.stateMu.Unlock()
		return errors.New("stale payment response rejected")
	}
	s.state.Order = &order
	s.state.CheckedAt = time.Now().UTC().Format(time.RFC3339)
	if order.Payment != "pending" {
		s.state.Code = nil
	}
	err := s.save()
	s.stateMu.Unlock()
	if err != nil {
		return err
	}
	return s.code(ctx)
}

func (s *PaymentTestServer) view() map[string]any {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	notify, _ := s.callbackURL()
	ready := s.secretReady()
	v := map[string]any{"amount": "1.00", "currency": "CNY", "callback_url": notify, "secret_saved": ready, "callback_test_verified": ready && s.state.TestNotice != nil, "merchant_order_no": s.state.Merchant, "creation_attempted": s.state.Attempted, "payment_status": "not_created", "paid_callback_verified": ready && s.state.PaidNotice != nil, "passed": false, "checked_at": s.state.CheckedAt}
	if s.state.Order != nil {
		o := s.state.Order
		v["order_id"], v["payment_status"], v["expires_at"] = o.ID, o.Payment, o.Expires
		v["passed"] = o.Payment == "paid" && ready && s.state.PaidNotice != nil
		if ready && s.state.TestNotice != nil && o.Payment == "pending" && s.state.PaidNotice == nil && s.state.Code != nil {
			if exp, err := time.Parse(time.RFC3339Nano, s.state.Code.Expires); err == nil && exp.After(time.Now()) {
				v["qr_image_data_url"] = s.state.Code.Image
			}
		}
	}
	return v
}

func (s *PaymentTestServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'nonce-"+s.local.token+"'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'")
	u, _ := url.Parse(s.local.origin)
	remote, _, _ := net.SplitHostPort(r.RemoteAddr)
	if r.Host != u.Host || !net.ParseIP(remote).IsLoopback() {
		http.Error(w, "loopback host required", 403)
		return
	}
	if r.URL.RawQuery != "" || r.URL.RawPath != "" {
		http.NotFound(w, r)
		return
	}
	if r.URL.Path == "/" && r.Method == "GET" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = template.Must(template.New("payment-test").Parse(paymentTestPage)).Execute(w, map[string]string{"Token": s.local.token})
		return
	}
	if r.URL.Path == "/favicon.ico" && r.Method == "GET" {
		w.WriteHeader(204)
		return
	}
	if r.Header.Get("X-Check-Token") != s.local.token {
		http.Error(w, "local token required", 403)
		return
	}
	if r.URL.Path == "/status" && r.Method == "GET" {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(s.view())
		return
	}
	if r.Method != "POST" || r.Header.Get("Origin") != s.local.origin || r.Header.Get("Content-Type") != "application/json" {
		http.Error(w, "same-origin JSON required", 403)
		return
	}
	if !slices.Contains([]string{"/setup", "/test-notification", "/create", "/refresh"}, r.URL.Path) {
		http.NotFound(w, r)
		return
	}
	var input struct {
		Secret string `json:"webhook_secret"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || r.URL.Path != "/setup" && input.Secret != "" {
		http.Error(w, "invalid local input", 400)
		return
	}
	if r.URL.Path == "/setup" {
		if err := s.configure(strings.TrimSpace(input.Secret)); err != nil {
			http.Error(w, "回调密钥未保存，请核对独立密钥及临时回调地址。", 409)
			return
		}
	} else {
		if !s.operation.TryLock() {
			http.Error(w, "已有操作进行中，请稍候。", 409)
			return
		}
		defer s.operation.Unlock()
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		var err error
		switch r.URL.Path {
		case "/test-notification":
			err = s.testNotification(ctx)
		case "/create":
			err = s.create(ctx)
		case "/refresh":
			err = s.refresh(ctx)
		}
		if err != nil {
			http.Error(w, "本次请求尚未完成，请保留原单并刷新核对。不会自动另开订单。", 503)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.view())
}
