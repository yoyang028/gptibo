package config

import (
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestQuefaMockRequiresIsolatedLoopbackConfiguration(t *testing.T) {
	remote := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	defer remote.Close()
	certificate := filepath.Join(t.TempDir(), "mock-ca.pem")
	if err := os.WriteFile(certificate, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: remote.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	for key, value := range map[string]string{"RECHARGE_ENABLED": "true", "RECHARGE_CHECKOUT_ENABLED": "true", "RECHARGE_API_BASE": remote.URL + "/v1", "RECHARGE_PARTNER_ID": "mock", "RECHARGE_KEY_ID": "mock", "RECHARGE_CLIENT_SECRET": "fixture", "RECHARGE_CLIENT_SECRET_FILE": "", "RECHARGE_WEBHOOK_SECRET": "fixture", "RECHARGE_WEBHOOK_SECRET_FILE": "", "RECHARGE_PRODUCT_MAP": "{\"plus\":\"plus\"}", "RECHARGE_COLLECTION_MODE": "platform_collect", "RECHARGE_NOTIFY_URL": "http://127.0.0.1:8094/api/recharge/webhook", "ORDER_TESTING_ENABLED": "false", "SESSION_PRECHECK_ENABLED": "false", "LOCAL_QUEFA_MOCK": "true", "DB_NAME": "gptibo_quefa_local", "PUBLIC_ORIGIN": "http://127.0.0.1:8094", "LISTEN_ADDR": "127.0.0.1:8094", "RECHARGE_LOCAL_CA_FILE": certificate} {
		t.Setenv(key, value)
	}
	service, err := LoadRecharge()
	if err != nil || service == nil || !service.Checkout {
		t.Fatal("valid isolated mock rejected", err)
	}
	if res, err := service.Client.HTTP.Get(remote.URL); err != nil {
		t.Fatal("private local certificate not trusted", err)
	} else {
		res.Body.Close()
	}
	if _, err = service.Client.HTTP.Get("https://outside.example.test"); err == nil {
		t.Fatal("local mock transport contacted an outside destination")
	}
	for _, tc := range []struct{ key, value string }{
		{"RECHARGE_API_BASE", "https://outside.example.test/v1"},
		{"PUBLIC_ORIGIN", "https://public.example.test"},
		{"LISTEN_ADDR", "0.0.0.0:8094"},
		{"DB_NAME", "gptibo_local"},
		{"LOCAL_QUEFA_MOCK", "false"},
	} {
		t.Run(tc.key, func(t *testing.T) {
			t.Setenv(tc.key, tc.value)
			if _, err := LoadRecharge(); err == nil {
				t.Fatal("unsafe mock configuration accepted")
			}
		})
	}
}
