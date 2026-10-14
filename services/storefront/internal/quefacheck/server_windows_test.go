package quefacheck

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalCredentialEntryProtectionAndEncryptedPersistence(t *testing.T) {
	directory := t.TempDir()
	server, err := NewServer("https://supplier.example.test/v1", directory, "http://127.0.0.1:8767")
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	server.probe = func(_ context.Context, _ string, c Credentials) Result {
		calls++
		if c.Partner != "pt_fixture" || c.Key != "key_fixture" || c.Secret != "fixture_only_secret_for_checks" {
			t.Fatal("credentials changed")
		}
		return Result{APIBase: server.base, Passed: true, Checks: []Check{}}
	}
	request := func(path, origin, token, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "http://127.0.0.1:8767"+path, strings.NewReader(body))
		r.RemoteAddr = "127.0.0.1:50000"
		r.Header.Set("Origin", origin)
		r.Header.Set("X-Check-Token", token)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		return w
	}
	credentials := `{"partner_id":"pt_fixture","key_id":"key_fixture","client_secret":"fixture_only_secret_for_checks"}`
	for _, tc := range []struct{ path, origin, token, body string }{
		{"/check", "https://outside.example.test", server.token, credentials},
		{"/check", server.origin, "wrong", credentials},
		{"/check", server.origin, server.token, `{"api_base":"https://outside.example.test/v1"}`},
		{"/check", server.origin, server.token, credentials + `{}`},
		{"/orders", server.origin, server.token, credentials},
	} {
		w := request(tc.path, tc.origin, tc.token, tc.body)
		if w.Code == 200 || strings.Contains(w.Body.String(), "fixture_only_secret") {
			t.Fatal("unsafe request accepted or echoed")
		}
	}
	for _, host := range []string{"outside.example.test:8767", "localhost:8767"} {
		r := httptest.NewRequest("GET", "http://"+host+"/", nil)
		r.RemoteAddr = "127.0.0.1:50000"
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal("host guard failed")
		}
	}
	r := httptest.NewRequest("GET", server.origin+"/", nil)
	r.RemoteAddr = "127.0.0.1:50000"
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), server.token) || w.Header().Get("Cache-Control") != "no-store" || !strings.Contains(w.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatal("invalid local form")
	}
	if calls != 0 {
		t.Fatal("query sent before explicit submit")
	}
	w = request("/check", server.origin, server.token, credentials)
	if w.Code != 200 || calls != 1 {
		t.Fatal("check failed", w.Code, w.Body.String())
	}
	encrypted, err := os.ReadFile(filepath.Join(directory, "credentials.dpapi"))
	if err != nil || strings.Contains(string(encrypted), "fixture") {
		t.Fatal("credentials not encrypted")
	}
	saved, err := server.load()
	if err != nil || saved.Secret != "fixture_only_secret_for_checks" {
		t.Fatal("cannot decrypt saved credentials")
	}
	for _, name := range []string{"result.json", "credentials.dpapi"} {
		data, _ := os.ReadFile(filepath.Join(directory, name))
		if strings.Contains(string(data), saved.Secret) {
			t.Fatal("plaintext persisted")
		}
	}
	w = request("/check", server.origin, server.token, `{"use_saved":true}`)
	if w.Code != 200 || calls != 2 {
		t.Fatal("saved credential check failed")
	}
	server.base = "https://different.example.test/v1"
	if _, err := server.load(); err == nil {
		t.Fatal("credentials reused with a different endpoint")
	}
	r = httptest.NewRequest("GET", server.origin+"/status", nil)
	r.RemoteAddr = "127.0.0.1:50000"
	r.Header.Set("X-Check-Token", server.token)
	w = httptest.NewRecorder()
	server.ServeHTTP(w, r)
	var result *Result
	if json.Unmarshal(w.Body.Bytes(), &result) != nil || result != nil {
		t.Fatal("old endpoint result shown for new endpoint")
	}
}
