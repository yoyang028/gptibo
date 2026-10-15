package quefamock

import (
	"context"
	"crypto/hmac"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"gptibo/storefront/internal/recharge"
	"gptibo/storefront/internal/security"
)

// Public fixtures intentionally have no authority outside this loopback server.
const Partner = "pt_local_mock"
const Key = "key_local_mock"
const Secret = "local_mock_signing_not_a_real_credential"
const WebhookSecret = "local_mock_webhook_not_a_real_credential"
const Product = "chatgpt_plus_cdk_1m"
const Callback = "http://127.0.0.1:8094/api/recharge/webhook"
const ControlOrigin = "http://127.0.0.1:8765"

type record struct {
	Order recharge.RemoteOrder  `json:"order"`
	Tasks []recharge.Redemption `json:"tasks"`
}
type replay struct {
	Hash string
	Data json.RawMessage
}
type event struct {
	ID, Kind string
	Body     json.RawMessage
}
type state struct {
	Orders         map[string]*record               `json:"orders"`
	Refunds        map[string]recharge.RemoteRefund `json:"refunds"`
	Replays        map[string]replay                `json:"replays"`
	Active         bool                             `json:"active"`
	Last           *event                           `json:"lastEvent"`
	CallbackStatus int                              `json:"callbackStatus"`
}
type server struct {
	mu         sync.Mutex
	directory  string
	data       state
	nonces     map[string]int64
	cloudflare bool
}

func Serve(directory string) error {
	return serve(directory, false)
}

// An independent fixed loopback profile for Workers/D1 acceptance. It has its
// own private state and certificate, and cannot send notifications off-machine.
func ServeCloudflare(directory string) error {
	return serve(directory, true)
}

func (s *server) apiOrigin() string {
	if s.cloudflare {
		return "https://127.0.0.1:8773"
	}
	return "https://127.0.0.1:8766"
}
func (s *server) controlOrigin() string {
	if s.cloudflare {
		return "http://127.0.0.1:8772"
	}
	return ControlOrigin
}
func (s *server) callbackURL() string {
	if s.cloudflare {
		return "https://127.0.0.1:8771/api/recharge/webhook"
	}
	return Callback
}

func serve(directory string, cloudflare bool) error {
	if err := Init(directory); err != nil {
		return err
	}
	s := &server{directory: directory, cloudflare: cloudflare, nonces: map[string]int64{}, data: state{Orders: map[string]*record{}, Refunds: map[string]recharge.RemoteRefund{}, Replays: map[string]replay{}, Active: true}}
	if raw, err := os.ReadFile(filepath.Join(directory, "state.json")); err == nil {
		if err = json.Unmarshal(raw, &s.data); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	api := &http.Server{Addr: strings.TrimPrefix(s.apiOrigin(), "https://"), Handler: http.HandlerFunc(s.api), ReadHeaderTimeout: 5 * time.Second}
	control := &http.Server{Addr: strings.TrimPrefix(s.controlOrigin(), "http://"), Handler: http.HandlerFunc(s.control), ReadHeaderTimeout: 5 * time.Second}
	results := make(chan error, 2)
	go func() {
		results <- api.ListenAndServeTLS(filepath.Join(directory, "cert.pem"), filepath.Join(directory, "key.pem"))
	}()
	go func() { results <- control.ListenAndServe() }()
	return <-results
}
func reply(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
func reject(w http.ResponseWriter, status int, code string) {
	reply(w, status, map[string]any{"error": map[string]any{"code": code, "retryable": false}})
}
func (s *server) save() error {
	raw, err := json.Marshal(s.data)
	if err != nil {
		return err
	}
	name := filepath.Join(s.directory, "state.json")
	if err = os.WriteFile(name+".tmp", raw, 0600); err != nil {
		return err
	}
	return os.Rename(name+".tmp", name)
}
func (s *server) api(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/healthz" && r.Method == "GET" {
		reply(w, 200, map[string]bool{"localMock": true})
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 65537))
	if err != nil || len(raw) > 65536 {
		reject(w, 400, "invalid_request")
		return
	}
	stamp, _ := strconv.ParseInt(r.Header.Get("X-Timestamp"), 10, 64)
	nonce, key := r.Header.Get("X-Nonce"), r.Header.Get("Idempotency-Key")
	if r.Header.Get("X-Partner-Id") != Partner || r.Header.Get("X-Key-Id") != Key || len(nonce) < 8 || stamp < time.Now().Unix()-300 || stamp > time.Now().Unix()+300 || !hmac.Equal([]byte(r.Header.Get("X-Signature")), []byte(recharge.Signature(Secret, r.Method, r.URL, r.Header.Get("X-Timestamp"), nonce, Key, key, string(raw)))) {
		reject(w, 401, "invalid_signature")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.nonces[nonce] > time.Now().Unix() {
		reject(w, 409, "nonce_replayed")
		return
	}
	s.nonces[nonce] = time.Now().Unix() + 600
	for n, expiry := range s.nonces {
		if expiry < time.Now().Unix() {
			delete(s.nonces, n)
		}
	}
	if !s.data.Active && r.URL.Path != "/v1/agent-profile" {
		reject(w, 403, "api_access_required")
		return
	}
	if r.Method != "GET" && (len(key) < 8 || len(key) > 120) {
		reject(w, 400, "invalid_request")
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/"), "/")
	identity := r.Method + ":" + r.URL.Path + ":" + key
	// Payment-code replays must re-check current state before returning old data.
	if len(parts) == 3 && parts[0] == "orders" && parts[2] == "payment-code" {
		item := s.data.Orders[parts[1]]
		if item == nil || item.Order.Payment != "pending" {
			reject(w, 409, "invalid_state_transition")
			return
		}
	}
	if previous, ok := s.data.Replays[identity]; ok && r.Method != "GET" {
		if previous.Hash != security.Hash(string(raw)) {
			reject(w, 409, "idempotency_conflict")
			return
		}
		reply(w, 200, map[string]any{"data": previous.Data})
		return
	}
	var data any
	status := 200
	switch {
	case r.Method == "GET" && r.URL.Path == "/v1/agent-profile":
		current := "active"
		if !s.data.Active {
			current = "suspended"
		}
		data = map[string]any{"merchant": map[string]string{"partnerId": Partner, "status": current}, "profile": map[string]bool{"customRedemptionEnabled": true}, "productSupplyPrices": map[string]string{Product: "11000"}, "collectionModes": []string{"platform_collect"}}
	case r.Method == "GET" && r.URL.Path == "/v1/products":
		data = []recharge.Product{{Code: Product, Supply: "110.00", MaxSale: "119.00", Currency: "CNY", Quantity: 1, Available: true, Modes: []string{"auto_recharge"}}}
	case r.Method == "GET" && r.URL.Path == "/v1/payment-methods":
		data = []map[string]string{{"code": "alipay", "name": "支付宝（本地模拟）"}}
	case r.Method == "POST" && r.URL.Path == "/v1/orders":
		var in struct {
			Merchant   string `json:"merchant_order_no"`
			Product    string `json:"product_code"`
			Quantity   int    `json:"quantity"`
			Sale       string `json:"sale_amount"`
			Collection string `json:"collection_mode"`
			Delivery   string `json:"delivery_mode"`
			Channel    string `json:"payment_channel"`
			Notify     string `json:"notify_url"`
		}
		if json.Unmarshal(raw, &in) != nil || in.Merchant == "" || in.Product != Product || in.Quantity != 1 || in.Collection != "platform_collect" || in.Delivery != "auto_recharge" || in.Channel != "alipay" || in.Notify != s.callbackURL() {
			reject(w, 400, "invalid_request")
			return
		}
		amount, e := recharge.Money(in.Sale)
		if e != nil || amount < 11000 {
			reject(w, 422, "price_out_of_range")
			return
		}
		for _, existing := range s.data.Orders {
			if existing.Order.Merchant == in.Merchant {
				reject(w, 409, "idempotency_conflict")
				return
			}
		}
		id := "QFMOCK" + strings.ReplaceAll(security.ID(), "-", "")
		expires := time.Now().Add(15 * time.Minute).UTC().Format(time.RFC3339Nano)
		link := s.apiOrigin() + "/payments/" + id + "?token=localmockonlynotarealpayment"
		order := recharge.RemoteOrder{ID: id, Merchant: in.Merchant, Product: Product, Quantity: 1, Currency: "CNY", Collection: "platform_collect", Scope: "retail", Delivery: "auto_recharge", Channel: "alipay", Sale: in.Sale, Supply: "110.00", Margin: recharge.Amount(amount - 11000), Refunded: "0.00", Payment: "pending", URL: &link, Expires: expires}
		s.data.Orders[id] = &record{Order: order, Tasks: []recharge.Redemption{}}
		data = order
		status = 201
	case r.Method == "GET" && r.URL.Path == "/v1/orders":
		list := []recharge.RemoteOrder{}
		for _, item := range s.data.Orders {
			if search := r.URL.Query().Get("merchant_order_no"); search == "" || search == item.Order.Merchant {
				list = append(list, item.Order)
			}
		}
		data = list
	case len(parts) >= 2 && parts[0] == "orders":
		item := s.data.Orders[parts[1]]
		if item == nil {
			reject(w, 404, "order_not_found")
			return
		}
		switch {
		case len(parts) == 2 && r.Method == "GET":
			data = item.Order
		case len(parts) == 3 && parts[2] == "payment-code" && r.Method == "POST":
			if string(raw) != "{}" {
				reject(w, 400, "invalid_request")
				return
			}
			data = map[string]any{"order_id": item.Order.ID, "merchant_order_no": item.Order.Merchant, "amount": item.Order.Sale, "currency": "CNY", "payment_status": "pending", "payment_code_type": "alipay_precreate", "payment_code": "https://qr.alipay.com/MOCKONLY" + item.Order.ID, "expires_at": item.Order.Expires}
		case len(parts) == 3 && parts[2] == "fulfillments" && r.Method == "GET":
			refs := []map[string]any{}
			for _, task := range item.Tasks {
				refs = append(refs, map[string]any{"fulfillment_id": task.ID, "order_id": task.Order, "attempt_no": task.Attempt})
			}
			data = refs
		case len(parts) == 3 && parts[2] == "refunds" && r.Method == "POST":
			var in struct {
				Merchant string `json:"merchant_refund_no"`
				Amount   string `json:"amount"`
			}
			if json.Unmarshal(raw, &in) != nil || in.Merchant == "" || item.Order.Payment != "paid" {
				reject(w, 409, "invalid_state_transition")
				return
			}
			amount, e := recharge.Money(in.Amount)
			sale, _ := recharge.Money(item.Order.Sale)
			if e != nil || amount <= 0 || amount > sale {
				reject(w, 400, "invalid_request")
				return
			}
			refund := recharge.RemoteRefund{ID: "refund_" + security.ID(), Order: item.Order.ID, Merchant: in.Merchant, Amount: in.Amount, Status: "requested"}
			if len(item.Tasks) == 0 || (item.Tasks[len(item.Tasks)-1].Status == "failed" && !item.Tasks[len(item.Tasks)-1].Paused) {
				refund.Status = "succeeded"
				s.applyRefund(item, amount)
			}
			s.data.Refunds[refund.ID] = refund
			data = refund
			status = 202
		default:
			reject(w, 404, "order_not_found")
			return
		}
	case r.Method == "POST" && r.URL.Path == "/v1/redemptions":
		var in struct {
			Mode       string          `json:"mode"`
			Order      string          `json:"order_id"`
			Credential json.RawMessage `json:"credential"`
			Confirmed  bool            `json:"customer_confirmed_email"`
			Retry      bool            `json:"retry_confirmation"`
		}
		if json.Unmarshal(raw, &in) != nil || in.Mode != "auto_recharge" || !in.Confirmed || len(in.Credential) == 0 {
			reject(w, 400, "invalid_request")
			return
		}
		item := s.data.Orders[in.Order]
		if item == nil || item.Order.Payment != "paid" {
			reject(w, 409, "invalid_state_transition")
			return
		}
		if len(item.Tasks) > 0 {
			last := item.Tasks[len(item.Tasks)-1]
			if last.Paused || !last.Retry || last.Next != "resubmit" || !in.Retry {
				reject(w, 409, "invalid_state_transition")
				return
			}
		}
		number, version := int64(len(item.Tasks)+1), int64(1)
		no := false
		email := "d***@example.invalid"
		stage := "queued"
		updated := time.Now().UTC().Format(time.RFC3339Nano)
		task := recharge.Redemption{ID: "ful_" + security.ID(), Order: in.Order, Status: "queued", Fallback: &no, Email: &email, Stage: &stage, Version: &version, Updated: &updated, Attempt: &number, Next: "wait"}
		item.Tasks = append(item.Tasks, task)
		item.Order.Fulfillment = "queued"
		data = task
		status = 202
	case r.Method == "GET" && len(parts) == 2 && parts[0] == "redemptions":
		for _, item := range s.data.Orders {
			for _, task := range item.Tasks {
				if task.ID == parts[1] {
					data = task
				}
			}
		}
		if data == nil {
			reject(w, 404, "order_not_found")
			return
		}
	case r.Method == "GET" && len(parts) == 2 && parts[0] == "refunds":
		value, ok := s.data.Refunds[parts[1]]
		if !ok {
			reject(w, 404, "order_not_found")
			return
		}
		data = value
	default:
		reject(w, 404, "order_not_found")
		return
	}
	if r.Method != "GET" {
		encoded, _ := json.Marshal(data)
		s.data.Replays[identity] = replay{Hash: security.Hash(string(raw)), Data: encoded}
		if err = s.save(); err != nil {
			reject(w, 500, "temporarily_unavailable")
			return
		}
	}
	reply(w, status, map[string]any{"data": data})
}
func (s *server) applyRefund(item *record, amount int64) {
	sale, _ := recharge.Money(item.Order.Sale)
	item.Order.Refunded = recharge.Amount(amount)
	item.Order.Payment = "partially_refunded"
	if amount == sale {
		item.Order.Payment = "refunded"
	}
	margin := sale - 11000 - amount
	item.Order.Margin = recharge.Amount(abs(margin))
	if margin < 0 {
		item.Order.Margin = "-" + item.Order.Margin
	}
	if amount == sale {
		item.Order.Margin = "-110.00"
		for i := range item.Tasks {
			task := &item.Tasks[i]
			task.Retry = false
			task.Next = "none"
			task.Recovery = "refund"
			no := false
			task.Fallback = &no
		}
	}
}
func abs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}
func (s *server) control(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" && r.URL.Path == "/" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		page := dashboard
		if s.cloudflare {
			page = strings.ReplaceAll(page, "http://127.0.0.1:5176", "https://127.0.0.1:8771")
		}
		_, _ = io.WriteString(w, page)
		return
	}
	if r.Method == "GET" && r.URL.Path == "/state" {
		s.mu.Lock()
		defer s.mu.Unlock()
		list := []*record{}
		for _, item := range s.data.Orders {
			list = append(list, item)
		}
		sort.Slice(list, func(i, j int) bool { return list[i].Order.Merchant > list[j].Order.Merchant })
		reply(w, 200, map[string]any{"localMock": true, "orders": list, "callbackStatus": s.data.CallbackStatus})
		return
	}
	if r.Method != "POST" || r.URL.Path != "/control" || r.Header.Get("Origin") != s.controlOrigin() {
		reject(w, 403, "invalid_request")
		return
	}
	var in struct {
		Order  string `json:"order"`
		Action string `json:"action"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&in) != nil {
		reject(w, 400, "invalid_request")
		return
	}
	s.mu.Lock()
	var out *event
	if in.Action == "replay" {
		out = s.data.Last
	} else if in.Action == "suspend" || in.Action == "activate" {
		s.data.Active = in.Action == "activate"
	} else {
		item := s.data.Orders[in.Order]
		if item == nil {
			s.mu.Unlock()
			reject(w, 404, "order_not_found")
			return
		}
		kind := "fulfillment.updated"
		if in.Action == "pay" {
			if item.Order.Payment != "pending" {
				s.mu.Unlock()
				reject(w, 409, "invalid_state_transition")
				return
			}
			item.Order.Payment = "paid"
			kind = "order.paid"
		} else if in.Action == "refund" {
			found := false
			for id, refund := range s.data.Refunds {
				if refund.Order == in.Order && refund.Status == "requested" {
					amount, _ := recharge.Money(refund.Amount)
					s.applyRefund(item, amount)
					refund.Status = "succeeded"
					s.data.Refunds[id] = refund
					found = true
				}
			}
			if !found {
				s.mu.Unlock()
				reject(w, 409, "invalid_state_transition")
				return
			}
			kind = "refund.succeeded"
		} else {
			if in.Action != "running" && in.Action != "pause" && in.Action != "fail" && in.Action != "success" {
				s.mu.Unlock()
				reject(w, 400, "invalid_request")
				return
			}
			if len(item.Tasks) == 0 || item.Order.Payment != "paid" {
				s.mu.Unlock()
				reject(w, 409, "invalid_state_transition")
				return
			}
			task := &item.Tasks[len(item.Tasks)-1]
			if task.Status == "succeeded" {
				s.mu.Unlock()
				reject(w, 409, "invalid_state_transition")
				return
			}
			task.Paused = false
			task.Retry = false
			no := false
			task.Fallback = &no
			task.Next = "wait"
			stage := "processing"
			task.Status = "running"
			switch in.Action {
			case "running":
			case "pause":
				task.Paused = true
				stage = "review"
			case "fail":
				task.Status = "failed"
				stage = "failed"
				task.Retry = true
				yes := true
				task.Fallback = &yes
				task.Next = "resubmit"
				code := "session_invalid"
				task.Failure = &code
				kind = "fulfillment.failed"
			case "success":
				task.Status = "succeeded"
				stage = "completed"
				task.Next = "none"
				task.Failure = nil
				kind = "fulfillment.succeeded"
			default:
				s.mu.Unlock()
				reject(w, 400, "invalid_request")
				return
			}
			task.Stage = &stage
			version := *task.Version + 1
			task.Version = &version
			now := time.Now().UTC().Format(time.RFC3339Nano)
			task.Updated = &now
			message := "本地模拟：充值处理中。"
			if task.Paused {
				message = "本地模拟：处理已暂停，结果尚未确认，请查询原任务。"
			}
			if task.Status == "failed" {
				message = "登录凭据已失效，请重新登录后提交。"
			}
			task.Message = &message
			if task.Status == "failed" || task.Status == "succeeded" {
				task.Finished = &now
			}
			item.Order.Fulfillment = task.Status
		}
		payload := map[string]any{"order_id": item.Order.ID, "merchant_order_no": item.Order.Merchant}
		id := "evt_" + security.ID()
		body, _ := json.Marshal(map[string]any{"event_id": id, "event": kind, "data": payload})
		out = &event{ID: id, Kind: kind, Body: body}
		s.data.Last = out
	}
	err := s.save()
	s.mu.Unlock()
	if err != nil {
		reject(w, 500, "temporarily_unavailable")
		return
	}
	if out != nil {
		go s.notify(*out)
	}
	reply(w, 200, map[string]bool{"ok": true})
}
func (s *server) notify(e event) {
	stamp := strconv.FormatInt(time.Now().Unix(), 10)
	req, _ := http.NewRequest("POST", s.callbackURL(), strings.NewReader(string(e.Body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Quefa-Event", e.Kind)
	req.Header.Set("X-Quefa-Event-Id", e.ID)
	req.Header.Set("X-Quefa-Delivery", "dlv_"+security.ID())
	req.Header.Set("X-Quefa-Timestamp", stamp)
	req.Header.Set("X-Quefa-Signature", "t="+stamp+",v1="+recharge.HMAC(WebhookSecret, stamp+"."+string(e.Body)))
	dialer := net.Dialer{Timeout: 3 * time.Second}
	callbackAddress := "127.0.0.1:8094"
	var tlsConfig *tls.Config
	if s.cloudflare {
		callbackAddress = "127.0.0.1:8771"
		roots := x509.NewCertPool()
		pem, err := os.ReadFile(filepath.Join(s.directory, "cert.pem"))
		if err != nil || !roots.AppendCertsFromPEM(pem) {
			return
		}
		tlsConfig = &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}
	}
	client := http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }, Transport: &http.Transport{TLSClientConfig: tlsConfig, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != callbackAddress {
			return nil, errors.New("callback destination rejected")
		}
		return dialer.DialContext(ctx, network, address)
	}}}
	status := 0
	if res, err := client.Do(req); err == nil {
		status = res.StatusCode
		_, _ = io.Copy(io.Discard, res.Body)
		_ = res.Body.Close()
	}
	s.mu.Lock()
	s.data.CallbackStatus = status
	_ = s.save()
	s.mu.Unlock()
}

const dashboard = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Quefa 本地模拟控制台</title><style>body{font:16px system-ui;max-width:1100px;margin:36px auto;background:#f6f7fa;color:#172033}article{background:white;padding:18px;margin:12px 0;border-radius:10px}button{padding:8px;margin:5px;cursor:pointer}code{word-break:break-all}small{display:block;color:#536071}</style><h1>Quefa 本地模拟控制台</h1><p>仅用于本机测试，不发生付款或充值。请勿扫描模拟付款码或填写真实账号资料。</p><p><a href="http://127.0.0.1:5176" target="_blank">测试商城</a> · <a href="http://127.0.0.1:5176/admin" target="_blank">测试管理后台</a></p><p>测试 Session：<code id="session"></code></p><button onclick="navigator.clipboard.writeText(document.querySelector('#session').textContent)">复制测试 Session</button><div id="orders"></div><p id="notice"></p><script>const exp=Math.floor(Date.now()/1000)+86400;const token=btoa(JSON.stringify({alg:'none'}))+'.'+btoa(JSON.stringify({exp}))+'.MOCKONLY';document.querySelector('#session').textContent=JSON.stringify({user:{email:'demo@example.invalid'},accessToken:token,expires:new Date(exp*1000).toISOString()});async function act(order,action){let r=await fetch('/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order,action})});document.querySelector('#notice').textContent=r.ok?'模拟操作已提交':'当前状态不允许此操作';await refresh()}async function refresh(){let s=await(await fetch('/state')).json();let root=document.querySelector('#orders');root.replaceChildren();for(let item of s.orders){let o=item.order,a=document.createElement('article');let title=document.createElement('strong');title.textContent=o.merchant_order_no+' · '+o.sale_amount+' 元';a.append(title);let info=document.createElement('small');info.textContent=o.order_id+' · 付款 '+o.payment_status+' · 充值 '+(o.fulfillment_status||'未提交');a.append(info);for(let [action,label] of [['pay','模拟付款'],['running','处理中'],['pause','暂停核对'],['fail','明确失败'],['success','充值成功'],['refund','确认待处理退款'],['replay','重复回调']]){let b=document.createElement('button');b.textContent=label;b.onclick=()=>act(o.order_id,action);a.append(b)}root.append(a)}}refresh();setInterval(refresh,3000)</script></html>`
