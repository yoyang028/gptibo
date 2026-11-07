package recharge

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"gptibo/storefront/internal/fault"
)

const CredentialBodyLimit = 256 * 1024
const credentialTokenLimit = 128 * 1024

// Validate the extracted token, not the size of unrelated Session feature data.
// Legacy Access-Token-only Session JSON is accepted only for original-key
// recovery; new Session submissions require their own sessionToken field.
func credentialToken(c Credential, legacy bool) (string, string, error) {
	raw, keys := c.Session, []string{"sessionToken", "session"}
	if c.Mode == "access_token" {
		raw, keys = c.AccessToken, []string{"accessToken", "access_token"}
	} else if c.Mode != "session" {
		return "", "", fault.New(400, "请选择有效的充值凭据类型。")
	}
	text := strings.TrimSpace(raw)
	if text == "" || !utf8.ValidString(text) {
		return "", "", fault.New(400, "请填写完整充值凭据。")
	}
	token, expires := text, ""
	if strings.HasPrefix(text, "{") || strings.HasPrefix(text, "[") {
		var root map[string]any
		if json.Unmarshal([]byte(text), &root) != nil || root == nil {
			return "", "", fault.New(400, "复制内容不完整，请重新完整复制后再提交。")
		}
		sources := []map[string]any{root}
		for _, key := range []string{"data", "auth"} {
			if nested, ok := root[key].(map[string]any); ok {
				sources = append(sources, nested)
			}
		}
		token = ""
		for _, source := range sources {
			if expires == "" {
				expires, _ = source["expires"].(string)
			}
			for _, key := range keys {
				if value, ok := source[key].(string); ok && strings.TrimSpace(value) != "" {
					token = strings.TrimSpace(value)
					break
				}
			}
			if token != "" {
				break
			}
		}
		if token == "" && legacy && c.Mode == "session" {
			token, _ = root["accessToken"].(string)
			token = strings.TrimSpace(token)
		}
		if token == "" {
			return "", "", fault.New(400, "未找到 sessionToken。充值会话凭据不能由 accessToken 替代，请查看充值凭据说明。")
		}
	}
	if len(token) > credentialTokenLimit {
		return "", "", fault.New(400, "提取后的充值令牌超过 128 KiB 字符限制。")
	}
	if c.Mode == "session" && !legacy && looksLikeAccessToken(token) {
		return "", "", fault.New(400, "这段内容是 Access Token，当前充值通道需要 sessionToken。")
	}
	for _, r := range token {
		if r < 0x21 || r > 0x7e {
			return "", "", fault.New(400, "充值凭据格式无效，请核对完整令牌。")
		}
	}
	return token, expires, nil
}

func looksLikeAccessToken(token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return false
	}
	headerBytes, hErr := base64.RawURLEncoding.DecodeString(parts[0])
	claimsBytes, cErr := base64.RawURLEncoding.DecodeString(parts[1])
	var header, claims map[string]any
	if hErr != nil || cErr != nil || json.Unmarshal(headerBytes, &header) != nil || json.Unmarshal(claimsBytes, &claims) != nil {
		return false
	}
	typ, _ := header["typ"].(string)
	if strings.EqualFold(typ, "at+jwt") || strings.EqualFold(typ, "application/at+jwt") || claims["token_use"] == "access" || claims["https://api.openai.com/auth"] != nil {
		return true
	}
	audiences, ok := claims["aud"].([]any)
	if !ok {
		audiences = []any{claims["aud"]}
	}
	for _, value := range audiences {
		if audience, ok := value.(string); ok && (audience == "https://api.openai.com" || strings.HasPrefix(audience, "https://api.openai.com/")) {
			return true
		}
	}
	return false
}
