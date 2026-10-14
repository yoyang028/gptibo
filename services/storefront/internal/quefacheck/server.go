package quefacheck

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html/template"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed page.html
var page string

type Server struct {
	base, directory, origin, token string
	probe                          func(context.Context, string, Credentials) Result
	mu                             sync.Mutex
	hookMu                         sync.Mutex
	hookWindow                     time.Time
	hookCount                      int
}

func NewServer(base, directory, origin string) (*Server, error) {
	api, e1 := url.Parse(base)
	local, e2 := url.Parse(origin)
	if e1 != nil || api.Scheme != "https" || api.Host == "" || api.User != nil || api.RawQuery != "" || api.Fragment != "" || api.Path != "/v1" || api.RawPath != "" || e2 != nil || local.Scheme != "http" || local.Hostname() != "127.0.0.1" || local.Port() == "" || local.User != nil || local.Path != "" || local.RawQuery != "" || local.Fragment != "" {
		return nil, errors.New("invalid fixed supplier endpoint or loopback origin")
	}
	if !filepath.IsAbs(directory) || !strings.EqualFold(filepath.VolumeName(directory), "D:") {
		return nil, errors.New("credential storage must use an absolute D-drive path")
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, errors.New("cannot prepare local credential directory")
	}
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return nil, err
	}
	return &Server{base: base, directory: directory, origin: origin, token: hex.EncodeToString(bytes), probe: func(ctx context.Context, base string, credentials Credentials) Result {
		return Probe(ctx, base, credentials, nil)
	}}, nil
}

func (s *Server) save(credentials Credentials) error {
	data, _ := json.Marshal(struct {
		Base string `json:"api_base"`
		Credentials
	}{s.base, credentials})
	encrypted, err := protect(data, false)
	clear(data)
	if err != nil {
		return errors.New("Windows credential encryption failed")
	}
	return atomicWrite(filepath.Join(s.directory, "credentials.dpapi"), encrypted)
}

func (s *Server) load() (Credentials, error) {
	encrypted, err := os.ReadFile(filepath.Join(s.directory, "credentials.dpapi"))
	if err != nil || len(encrypted) == 0 || len(encrypted) > 32768 {
		return Credentials{}, errors.New("no readable saved credentials")
	}
	data, err := protect(encrypted, true)
	if err != nil {
		return Credentials{}, errors.New("saved credentials require the same Windows user")
	}
	defer clear(data)
	var saved struct {
		Base string `json:"api_base"`
		Credentials
	}
	if json.Unmarshal(data, &saved) != nil || saved.Base != s.base || !saved.Credentials.valid() {
		return Credentials{}, errors.New("saved credentials do not match this endpoint")
	}
	return saved.Credentials, nil
}

func atomicWrite(path string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".readonly-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(data)
	}
	if err == nil {
		err = file.Sync()
	}
	closed := file.Close()
	if err != nil {
		return err
	}
	if closed != nil {
		return closed
	}
	return os.Rename(file.Name(), path)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'nonce-"+s.token+"'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'")
	local, _ := url.Parse(s.origin)
	remote, _, _ := net.SplitHostPort(r.RemoteAddr)
	if r.Host != local.Host || !net.ParseIP(remote).IsLoopback() {
		http.Error(w, "loopback host required", 403)
		return
	}
	if r.URL.Path == "/" && r.Method == "GET" {
		s.mu.Lock()
		_, err := s.load()
		s.mu.Unlock()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = template.Must(template.New("page").Parse(page)).Execute(w, map[string]any{"Base": s.base, "Token": s.token, "Saved": err == nil})
		return
	}
	if r.URL.Path == "/favicon.ico" && r.Method == "GET" {
		w.WriteHeader(204)
		return
	}
	if r.Header.Get("X-Check-Token") != s.token {
		http.Error(w, "local check token required", 403)
		return
	}
	if r.URL.Path == "/webhook-secret" || r.URL.Path == "/webhook-status" {
		s.serveWebhookControl(w, r)
		return
	}
	if r.URL.Path == "/status" && r.Method == "GET" {
		w.Header().Set("Content-Type", "application/json")
		s.mu.Lock()
		defer s.mu.Unlock()
		data, err := os.ReadFile(filepath.Join(s.directory, "result.json"))
		var result Result
		if err != nil || json.Unmarshal(data, &result) != nil || result.APIBase != s.base {
			_, _ = w.Write([]byte("null"))
		} else {
			_, _ = w.Write(data)
		}
		return
	}
	if r.URL.Path != "/check" || r.Method != "POST" {
		http.NotFound(w, r)
		return
	}
	if r.Header.Get("Origin") != s.origin || r.Header.Get("Content-Type") != "application/json" {
		http.Error(w, "same-origin JSON required", 403)
		return
	}
	if !s.mu.TryLock() {
		http.Error(w, "check already running", 409)
		return
	}
	defer s.mu.Unlock()
	var input struct {
		Credentials
		Saved bool `json:"use_saved"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF {
		http.Error(w, "invalid credential fields", 400)
		return
	}
	credentials := input.Credentials
	if input.Saved {
		var err error
		credentials, err = s.load()
		if err != nil {
			http.Error(w, "cannot load saved credentials; enter the original values", 400)
			return
		}
	} else {
		credentials.Partner = strings.TrimSpace(credentials.Partner)
		credentials.Key = strings.TrimSpace(credentials.Key)
		credentials.Secret = strings.TrimSpace(credentials.Secret)
		if !credentials.valid() {
			http.Error(w, "invalid credential fields; fill partner_id, key_id and client_secret", 400)
			return
		}
		if err := s.save(credentials); err != nil {
			http.Error(w, "cannot encrypt and save credentials; check was not sent", 500)
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	result := s.probe(ctx, s.base, credentials)
	data, _ := json.MarshalIndent(result, "", "  ")
	if err := atomicWrite(filepath.Join(s.directory, "result.json"), data); err != nil {
		http.Error(w, "check finished but local result could not be saved", 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(data)
}
