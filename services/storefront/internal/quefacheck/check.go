// Package quefacheck checks supplier credentials without creating business data.
package quefacheck

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"gptibo/storefront/internal/recharge"
)

const PlusCode = "chatgpt_plus_cdk_1m"

type Credentials struct {
	Partner string `json:"partner_id"`
	Key     string `json:"key_id"`
	Secret  string `json:"client_secret"`
}

func (c Credentials) valid() bool {
	id := regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	return id.MatchString(c.Partner) && id.MatchString(c.Key) && len(c.Secret) >= 16 && len(c.Secret) <= 4096 && strings.IndexFunc(c.Secret, func(r rune) bool { return r <= ' ' || r > '~' }) < 0
}

type Check struct {
	Name   string `json:"name"`
	State  string `json:"state"`
	Detail string `json:"detail"`
}

type Result struct {
	CheckedAt string  `json:"checked_at"`
	APIBase   string  `json:"api_base"`
	Passed    bool    `json:"passed"`
	Tier      string  `json:"tier,omitempty"`
	Supply    string  `json:"plus_supply_price,omitempty"`
	Checks    []Check `json:"checks"`
	ErrorCode string  `json:"error_code,omitempty"`
	HTTPCode  int     `json:"http_status,omitempty"`
	RequestID string  `json:"request_id,omitempty"`
}

// readOnlyTransport is a final guard, even if a future caller changes Request.
// There are no write endpoints, arbitrary queries, redirects or environment proxies.
type readOnlyTransport struct {
	base *url.URL
	next http.RoundTripper
}

func (t readOnlyTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.Method != http.MethodGet || r.URL.Scheme != t.base.Scheme || r.URL.Host != t.base.Host || r.URL.User != nil || r.URL.RawQuery != "" || r.URL.Fragment != "" || r.URL.RawPath != "" || r.ContentLength != 0 || r.Body != nil && r.Body != http.NoBody || !slices.Contains([]string{"/v1/agent-profile", "/v1/products"}, r.URL.Path) {
		return nil, errors.New("read-only supplier check rejected request")
	}
	return t.next.RoundTrip(r)
}

func Probe(ctx context.Context, base string, credentials Credentials, transport http.RoundTripper) Result {
	result := Result{CheckedAt: time.Now().UTC().Format(time.RFC3339), APIBase: base, Checks: []Check{}}
	if !credentials.valid() {
		result.Checks = append(result.Checks, Check{"凭据格式", "fail", "请填写同一应用的 partner_id、key_id 和 client_secret，勿填写网站登录密码或 ChatGPT Session。"})
		return result
	}
	client, err := recharge.NewClient(base, credentials.Partner, credentials.Key, credentials.Secret)
	if err != nil {
		result.Checks = append(result.Checks, Check{"API 地址", "fail", "配置必须为供应商提供的 HTTPS /v1 地址。"})
		return result
	}
	address, _ := url.Parse(client.Base)
	if transport == nil {
		direct := http.DefaultTransport.(*http.Transport).Clone()
		direct.Proxy = nil
		transport = direct
		defer direct.CloseIdleConnections()
	}
	client.HTTP.Transport = readOnlyTransport{base: address, next: transport}
	var profile struct {
		recharge.AgentProfile
		Profile struct {
			Tier       string `json:"tier"`
			Redemption *bool  `json:"customRedemptionEnabled"`
			DirectCode *bool  `json:"directPaymentCodeEnabled"`
		} `json:"profile"`
	}
	if err = client.Request(ctx, "/agent-profile", nil, "", &profile); err != nil {
		return failed(result, "签名与账户查询", err)
	}
	add := func(name string, ok bool, yes, no string) {
		state, detail := "pass", yes
		if !ok {
			state, detail = "fail", no
		}
		result.Checks = append(result.Checks, Check{name, state, detail})
	}
	add("签名与账户查询", true, "账户查询已返回有效数据。", "")
	add("账户身份", profile.Merchant.Partner == credentials.Partner, "响应与输入的代理身份一致。", "响应身份不一致，不能继续用于商城。")
	add("账户状态", profile.Merchant.Status == "active", "账户为 active。", "账户不是 active，需要供货方核对启用状态。")
	if regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`).MatchString(profile.Profile.Tier) {
		result.Tier = profile.Profile.Tier
	}
	flag := func(name string, value *bool) {
		if value == nil {
			result.Checks = append(result.Checks, Check{name, "unknown", "接口没有返回此能力字段，尚未确认。"})
			return
		}
		add(name, *value, "当前已启用。", "当前未启用，需要供货方核对权限。")
	}
	flag("自有商城自动充值权限", profile.Profile.Redemption)
	flag("自有页面付款码权限", profile.Profile.DirectCode)
	add("平台代收模式", slices.Contains(profile.Modes, "platform_collect"), "账户允许 platform_collect。", "账户未返回平台代收权限。")
	minor, err := strconv.ParseInt(profile.Prices[PlusCode], 10, 64)
	authorized := err == nil && minor >= 0 && minor < 10000000000
	add("ChatGPT Plus 商品授权", authorized, "账户返回了 Plus 的有效供货价。", "账户未返回 Plus 的有效授权价格。")
	var products []recharge.Product
	if err = client.Request(ctx, "/products", nil, "", &products); err != nil {
		return failed(result, "商品目录查询", err)
	}
	add("商品目录查询", true, "商品目录查询已返回有效数据。", "")
	found := false
	for _, product := range products {
		if product.Code != PlusCode {
			continue
		}
		if found {
			add("Plus 目录一致性", false, "", "目录出现重复的 Plus 商品，需供货方确认。")
			continue
		}
		found = true
		price, moneyErr := recharge.Money(product.Supply)
		if moneyErr == nil && product.Currency == "CNY" {
			result.Supply = product.Supply + " CNY"
		}
		add("Plus 当前可售", product.Available && product.Quantity >= 1, "目录显示当前可售。", "目录显示当前不可售或数量受限。")
		add("Plus 自动直充方式", slices.Contains(product.Modes, "auto_recharge"), "目录支持 auto_recharge。", "目录没有返回自动直充方式。")
		add("Plus 供货价一致性", authorized && moneyErr == nil && product.Currency == "CNY" && price == minor, "账户授权价格与商品目录一致。", "账户价格、商品价格或币种未能一致验证。")
	}
	if !found {
		add("Plus 商品目录", false, "", "商品目录没有返回 ChatGPT Plus。")
	}
	result.Passed = true
	for _, check := range result.Checks {
		result.Passed = result.Passed && check.State == "pass"
	}
	return result
}

func failed(result Result, name string, err error) Result {
	detail := "查询未完成，请稍后手动重试。"
	var api *recharge.APIError
	if errors.As(err, &api) {
		result.ErrorCode, result.HTTPCode, result.RequestID = api.Code, api.HTTPStatus, api.RequestID
		switch api.Code {
		case "invalid_signature":
			detail = "签名未通过；请核对三个凭据是否来自同一个应用，是否遗漏或多复制字符。"
		case "api_access_required":
			detail = "供应商拒绝了 API 权限；需确认账号权限，不要据此直接购买资格。"
		case "ip_not_allowed":
			detail = "供应商应用的 IP 白名单拒绝了本机出口。"
		case "timestamp_out_of_range":
			detail = "供应商认为请求时间超出范围，请核对本机时钟。"
		case "transport_unknown":
			detail = "HTTPS 连接未完成，可能为网络、证书或超时；未进行订单或充值操作。"
		case "redirect_rejected":
			detail = "供应商返回了跳转，检查器没有跟随；请核对 API 地址。"
		case "invalid_response":
			detail = "供应商响应格式与接入文档不一致，尚不能确认接口可用。"
		}
	}
	result.Passed = false
	result.Checks = append(result.Checks, Check{name, "fail", detail})
	return result
}
