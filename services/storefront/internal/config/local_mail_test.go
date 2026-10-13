package config

import (
	"strings"
	"testing"
)

func TestLocalMailRequiresLoopbackAndIsolatedTransport(t *testing.T) {
	for _, key := range []string{"ADMIN_USERNAME", "ADMIN_EMAIL", "ADMIN_TOTP_SECRET", "ADMIN_TOTP_SECRET_FILE", "AUTH_SECRET_FILE", "ADMIN_ACCESS_ISSUER", "ADMIN_ACCESS_AUDIENCE", "TURNSTILE_ENABLED", "AUTH_TURNSTILE_ENABLED", "SECURITY_AUDIT_ENABLED", "MIGRATION_REHEARSAL"} {
		t.Setenv(key, "")
	}
	t.Setenv("LOCAL_MAIL_DIR", t.TempDir())
	t.Setenv("MAIL_FROM", "Dev <noreply@example.invalid>")
	t.Setenv("AUTH_SECRET", strings.Repeat("ab", 32))
	for _, tc := range []struct {
		origin, listen, enabled string
		valid                   bool
	}{
		{"http://127.0.0.1:8093", "127.0.0.1:8093", "false", true},
		{"http://localhost:8093", "[::1]:8093", "false", true},
		{"https://public.example.invalid", "127.0.0.1:8093", "false", false},
		{"http://127.0.0.1:8093", "0.0.0.0:8093", "false", false},
		{"http://127.0.0.1:8093", "localhost:8093", "false", false},
		{"http://127.0.0.1:8093", "127.0.0.1:8093", "true", false},
	} {
		t.Setenv("PUBLIC_ORIGIN", tc.origin)
		t.Setenv("LISTEN_ADDR", tc.listen)
		t.Setenv("MAIL_ENABLED", tc.enabled)
		h, err := LoadHTTP()
		if (err == nil) != tc.valid || tc.valid && h.Auth.Sender == nil {
			t.Fatal("incorrect local mailbox isolation", tc, err)
		}
	}
	t.Setenv("MIGRATION_REHEARSAL", "true")
	if h, err := LoadHTTP(); err != nil || h.Auth.Sender != nil {
		t.Fatal("rehearsal enabled local mail", err)
	}
}
