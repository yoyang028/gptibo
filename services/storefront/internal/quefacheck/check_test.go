package quefacheck

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"gptibo/storefront/internal/recharge"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestProbeSignsOnlyAllowedReadsAndSanitizesOutput(t *testing.T) {
	credentials := Credentials{"pt_fixture", "key_fixture", "fixture_only_secret_for_checks"}
	profile := map[string]any{
		"merchant":            map[string]any{"partnerId": credentials.Partner, "status": "active", "name": "DO_NOT_PERSIST_PRIVATE_NAME"},
		"profile":             map[string]any{"tier": "partner", "customRedemptionEnabled": true, "directPaymentCodeEnabled": true},
		"productSupplyPrices": map[string]string{PlusCode: "11000"}, "collectionModes": []string{"platform_collect"},
	}
	product := recharge.Product{Code: PlusCode, Supply: "110.00", Currency: "CNY", Quantity: 1, Available: true, Modes: []string{"auto_recharge"}}
	for _, name := range []string{"valid", "suspended", "identity mismatch", "redemption disabled", "missing payment code flag", "no collection mode", "unauthorized Plus", "price mismatch", "unavailable", "missing product", "duplicate product", "wrong currency", "no auto recharge", "no payment channels", "USDT only", "payment channel query rejected"} {
		t.Run(name, func(t *testing.T) {
			// Deep copy the wire fixture; do not share mutable maps between cases.
			raw, _ := json.Marshal(profile)
			var p map[string]any
			_ = json.Unmarshal(raw, &p)
			products := []recharge.Product{product}
			switch name {
			case "suspended":
				p["merchant"].(map[string]any)["status"] = "suspended"
			case "identity mismatch":
				p["merchant"].(map[string]any)["partnerId"] = "other"
			case "redemption disabled":
				p["profile"].(map[string]any)["customRedemptionEnabled"] = false
			case "missing payment code flag":
				delete(p["profile"].(map[string]any), "directPaymentCodeEnabled")
			case "no collection mode":
				p["collectionModes"] = []string{"agent_collect"}
			case "unauthorized Plus":
				p["productSupplyPrices"] = map[string]string{}
			case "price mismatch":
				products[0].Supply = "111.00"
			case "unavailable":
				products[0].Available = false
			case "missing product":
				products = nil
			case "duplicate product":
				products = append(products, product)
			case "wrong currency":
				products[0].Currency = "USD"
			case "no auto recharge":
				products[0].Modes = []string{"cdk"}
			}
			var paths, nonces []string
			result := Probe(context.Background(), "https://supplier.example.test/v1", credentials, transportFunc(func(r *http.Request) (*http.Response, error) {
				paths = append(paths, r.URL.Path)
				nonce := r.Header.Get("X-Nonce")
				if r.Method != "GET" || r.Header.Get("Idempotency-Key") != "" || r.Header.Get("X-Partner-Id") != credentials.Partner || nonce == "" || len(nonces) > 0 && nonces[0] == nonce || r.Header.Get("X-Signature") != recharge.Signature(credentials.Secret, "GET", r.URL, r.Header.Get("X-Timestamp"), nonce, credentials.Key, "", "") {
					t.Fatal("incorrect read-only signature or request")
				}
				nonces = append(nonces, nonce)
				var data any
				switch r.URL.Path {
				case "/v1/agent-profile":
					data = p
				case "/v1/products":
					data = products
				case "/v1/payment-methods":
					data = []map[string]string{{"code": "alipay"}}
					if name == "no payment channels" {
						data = []map[string]string{}
					}
					if name == "USDT only" {
						data = []map[string]string{{"code": "usdt"}}
					}
					if name == "payment channel query rejected" {
						return &http.Response{StatusCode: 403, Body: io.NopCloser(strings.NewReader(`{"error":{"code":"api_access_required"}}`))}, nil
					}
				default:
					t.Fatal("unexpected endpoint")
				}
				body, _ := json.Marshal(map[string]any{"data": data})
				// A missing catalogue uses [] rather than a null success envelope.
				if name == "missing product" && r.URL.Path == "/v1/products" {
					body = []byte(`{"data":[]}`)
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(body)))}, nil
			}))
			if result.Passed != (name == "valid") || len(paths) != 3 || paths[0] != "/v1/agent-profile" || paths[1] != "/v1/products" || paths[2] != "/v1/payment-methods" {
				t.Fatal("incorrect check result or requests", result)
			}
			output, _ := json.Marshal(result)
			for _, private := range []string{credentials.Secret, credentials.Key, credentials.Partner, "DO_NOT_PERSIST_PRIVATE_NAME"} {
				if strings.Contains(string(output), private) {
					t.Fatal("private value in result")
				}
			}
			if name == "valid" && (result.Supply != "110.00 CNY" || result.Tier != "partner" || len(result.Methods) != 1 || result.Methods[0] != "alipay") {
				t.Fatal("missing price or tier")
			}
		})
	}
}

func TestReadOnlyTransportRejectsWritesOtherEndpointsAndDestinations(t *testing.T) {
	base, _ := url.Parse("https://supplier.example.test/v1")
	forwarded := 0
	transport := readOnlyTransport{base, transportFunc(func(*http.Request) (*http.Response, error) { forwarded++; return nil, nil })}
	for _, tc := range []struct{ method, address, body string }{
		{"POST", "https://supplier.example.test/v1/agent-profile", "{}"},
		{"POST", "https://supplier.example.test/v1/orders", "{}"},
		{"POST", "https://supplier.example.test/v1/payment-methods", "{}"},
		{"GET", "https://supplier.example.test/v1/orders", ""},
		{"GET", "https://other.example.test/v1/products", ""},
		{"GET", "http://supplier.example.test/v1/products", ""},
		{"GET", "https://supplier.example.test/v1/products?limit=1", ""},
		{"GET", "https://supplier.example.test/v1/%70roducts", ""},
		{"GET", "https://supplier.example.test/v1/products", "{}"},
	} {
		r, _ := http.NewRequest(tc.method, tc.address, strings.NewReader(tc.body))
		if _, err := transport.RoundTrip(r); err == nil {
			t.Fatal("forbidden request accepted", tc.method, tc.address)
		}
	}
	if forwarded != 0 {
		t.Fatal("forbidden request reached transport")
	}
}

func TestAuthFailureStopsAfterFirstReadAndDoesNotEchoUpstreamMessage(t *testing.T) {
	calls := 0
	result := Probe(context.Background(), "https://supplier.example.test/v1", Credentials{"pt_fixture", "key_fixture", "fixture_only_secret_for_checks"}, transportFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 403, Header: http.Header{"X-Request-Id": []string{"req_fixture"}}, Body: io.NopCloser(strings.NewReader(`{"error":{"code":"api_access_required","message":"DO_NOT_ECHO_UPSTREAM_MESSAGE"}}`))}, nil
	}))
	output, _ := json.Marshal(result)
	if calls != 1 || result.Passed || result.ErrorCode != "api_access_required" || result.HTTPCode != 403 || result.RequestID != "req_fixture" || strings.Contains(string(output), "DO_NOT_ECHO") {
		t.Fatal("incorrect failure handling", result)
	}
}
