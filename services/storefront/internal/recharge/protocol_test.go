package recharge

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestQuefaPublishedSigningVectors(t *testing.T) {
	body := `{"merchant_order_no":"DEMO-中文-001","product_code":"chatgpt_plus_cdk_1m","quantity":1,"sale_amount":"135.00","collection_mode":"platform_collect","delivery_mode":"auto_recharge"}`
	for _, tc := range []struct{ method, address, body, stamp, nonce, key, want string }{
		{"POST", "https://supplier.example.test/v1/orders", body, "1790323200", "demo-nonce-0001", "demo-order-0001", "82844463eb516b0891b81956465ee7e4c240e5fec403da12f0c4ea5e5d7cd1e0"},
		{"GET", "https://supplier.example.test/v1/orders?search=%E6%B5%8B%E8%AF%95&limit=20&payment_status=paid", "", "1790323260", "demo-nonce-0002", "", "9913c8b36f8354f1a15d6c8a875fa9f45b846a1ea33b054212d30c9e30dd3496"},
		{"POST", "https://supplier.example.test/v1/orders", body, "1790323320", "demo-nonce-0003", "demo-order-0001", "4688e31de9214846fc167d1756a863d83837238ebdc4f394b39e84a6bdb6f207"},
	} {
		address, _ := url.Parse(tc.address)
		if Signature("tibo_demo_secret_never_use_in_production", tc.method, address, tc.stamp, tc.nonce, "key_demo_01", tc.key, tc.body) != tc.want {
			t.Fatal("published signature vector mismatch")
		}
	}
}

func TestQuoteChecksCurrentPermissionsAndIgnoresLegacySaleCap(t *testing.T) {
	for _, tc := range []struct {
		name    string
		change  func(*AgentProfile)
		price   int64
		allowed bool
	}{
		{"above legacy cap", nil, 17000, true},
		{"below supply", nil, 10000, false},
		{"suspended", func(p *AgentProfile) { p.Merchant.Status = "suspended" }, 17000, false},
		{"wrong partner", func(p *AgentProfile) { p.Merchant.Partner = "other" }, 17000, false},
		{"redemption disabled", func(p *AgentProfile) { p.Profile.Redemption = false }, 17000, false},
		{"product unauthorized", func(p *AgentProfile) { p.Prices = map[string]string{} }, 17000, false},
		{"collection unauthorized", func(p *AgentProfile) { p.Modes = []string{"agent_collect"} }, 17000, false},
		{"changed supply", func(p *AgentProfile) { p.Prices["plus"] = "12000" }, 17000, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := NewClient("https://fixture.example.test/v1", "tenant", "key", "secret")
			var p AgentProfile
			p.Merchant.Partner = "tenant"
			p.Merchant.Status = "active"
			p.Profile.Redemption = true
			p.Prices = map[string]string{"plus": "11000"}
			p.Modes = []string{"platform_collect"}
			if tc.change != nil {
				tc.change(&p)
			}
			c.HTTP.Transport = transport(func(r *http.Request) (*http.Response, error) {
				var data any
				switch r.URL.Path {
				case "/v1/agent-profile":
					data = p
				case "/v1/products":
					data = []Product{{Code: "plus", Supply: "110.00", MaxSale: "119.00", Currency: "CNY", Quantity: 1, Available: true, Modes: []string{"auto_recharge"}}}
				case "/v1/payment-methods":
					data = []map[string]string{{"code": "alipay"}}
				default:
					t.Fatal("unexpected endpoint")
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(Raw(map[string]any{"data": data})))}, nil
			})
			s := Service{Client: c, Checkout: true, Products: map[string]string{"plus": "plus"}}
			cost := int64(11000)
			_, err := s.Quote(context.Background(), "plus", tc.price, &cost)
			if (err == nil) != tc.allowed {
				t.Fatal("incorrect permission or price decision", err)
			}
		})
	}
}

func TestSignedPaymentCodeBinding(t *testing.T) {
	for _, bad := range []string{"", "amount", "order_id", "merchant_order_no", "currency", "payment_code", "payment_status", "expires_at"} {
		t.Run(bad, func(t *testing.T) {
			c, _ := NewClient("https://fixture.example.test/v1", "tenant", "key", "secret")
			expires := time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339Nano)
			c.HTTP.Transport = transport(func(r *http.Request) (*http.Response, error) {
				raw, _ := io.ReadAll(r.Body)
				if r.Method != "POST" || r.URL.Path != "/v1/orders/order/payment-code" || string(raw) != "{}" || r.Header.Get("Idempotency-Key") == "" || r.Header.Get("X-Signature") == "" {
					t.Fatal("incorrect signed payment-code request")
				}
				data := map[string]any{"order_id": "order", "merchant_order_no": "local", "amount": "139.00", "currency": "CNY", "payment_status": "pending", "payment_code_type": "alipay_precreate", "payment_code": "https://qr.alipay.com/MOCKONLY12345678", "expires_at": expires}
				if bad != "" {
					data[bad] = "tampered"
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(Raw(map[string]any{"data": data})))}, nil
			})
			qr, err := c.QR(context.Background(), RemoteOrder{ID: "order", Merchant: "local", Sale: "139.00", Payment: "pending", Expires: expires}, time.Now().Add(time.Minute).UnixMilli())
			if bad == "" && (err != nil || qr == nil) {
				t.Fatal("valid QR rejected", err)
			}
			if bad != "" && err == nil {
				t.Fatal("tampered payment code accepted")
			}
		})
	}
}
