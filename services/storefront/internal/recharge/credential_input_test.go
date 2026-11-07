package recharge

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestSessionTokenContract(t *testing.T) {
	for _, raw := range []string{`{"sessionToken":"session-fixture","accessToken":"different-access"}`, `{"data":{"sessionToken":"session-fixture"}}`, `{"auth":{"session":"session-fixture"}}`, "session-fixture"} {
		token, _, err := credentialToken(Credential{Mode: "session", Session: raw}, false)
		if err != nil || token != "session-fixture" {
			t.Fatal("actual Session Token not preserved", err)
		}
	}
	legacy := Credential{Mode: "session", Session: `{"accessToken":"legacy-access"}`}
	if _, _, err := credentialToken(legacy, false); err == nil {
		t.Fatal("new Session attempt accepted Access Token only")
	}
	if _, _, err := credentialToken(legacy, true); err != nil {
		t.Fatal("original-key recovery cannot read legacy input", err)
	}
}

func TestSessionTokenLimitAfterExtraction(t *testing.T) {
	boundary := strings.Repeat("s", credentialTokenLimit)
	raw := Raw(map[string]any{"sessionToken": boundary, "featureFlags": strings.Repeat("x", 200000)})
	if token, _, err := credentialToken(Credential{Mode: "session", Session: raw}, false); err != nil || token != boundary {
		t.Fatal("unrelated JSON length blocked extraction", err)
	}
	if _, _, err := credentialToken(Credential{Mode: "session", Session: boundary + "x"}, false); err == nil {
		t.Fatal("oversized actual token accepted")
	}
}

func TestSessionTokenExpiryIgnoresDifferentAccessToken(t *testing.T) {
	c := Credential{Mode: "session", Session: `{"sessionToken":"session-fixture","accessToken":"e30.eyJleHAiOjF9.fixture","expires":"2099-01-01T00:00:00Z"}`}
	if err := credentialExpiry(c, time.Now()); err != nil {
		t.Fatal("Access Token expiry was applied to the Session Token", err)
	}
}

func TestSessionModeRejectsExplicitAccessJWTForNewRequestsOnly(t *testing.T) {
	token := base64.RawURLEncoding.EncodeToString([]byte(`{"typ":"at+jwt"}`)) + "." + base64.RawURLEncoding.EncodeToString([]byte(`{}`)) + ".fixture"
	if _, _, err := credentialToken(Credential{Mode: "session", Session: token}, false); err == nil {
		t.Fatal("access JWT accepted as a new Session Token")
	}
	if _, _, err := credentialToken(Credential{Mode: "session", Session: token}, true); err != nil {
		t.Fatal("original-key recovery blocked before hash comparison", err)
	}
}
