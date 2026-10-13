package mailer

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestLocalMailboxAuthenticationAndIdempotency(t *testing.T) {
	directory := t.TempDir()
	l, err := NewLocalMailbox(directory, "GPTibo Dev <noreply@example.invalid>", "http://127.0.0.1:5175")
	if err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"admin", "partner", "customer"} {
		if err := l.SendCode(context.Background(), role, role+"@example.invalid", "654321", role); err != nil {
			t.Fatal(err)
		}
	}
	if err := l.SendInvitation(context.Background(), "partner@example.invalid", "http://127.0.0.1:5175", "invite"); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(directory, "*.json"))
	if len(files) != 4 {
		t.Fatal("authentication and invitation messages were not retained")
	}
	body, err := l.Freeze("customer@example.invalid", Message{Text: "local fixture"})
	if err != nil {
		t.Fatal(err)
	}
	var writers sync.WaitGroup
	for range 4 {
		writers.Go(func() {
			if _, err := l.SendFrozen(context.Background(), body, "same-message"); err != nil {
				t.Error(err)
			}
		})
	}
	writers.Wait()
	files, _ = filepath.Glob(filepath.Join(directory, "*.json"))
	if len(files) != 5 {
		t.Fatal("concurrent retries created duplicate messages")
	}
	if _, err := l.SendFrozen(context.Background(), strings.ReplaceAll(body, "local fixture", "changed"), "same-message"); err == nil {
		t.Fatal("conflicting message reused an idempotency key")
	}
	if _, err := l.SendFrozen(context.Background(), `{}`, "invalid"); err == nil {
		t.Fatal("invalid frozen message accepted")
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := l.SendFrozen(cancelled, body, "cancelled"); err == nil {
		t.Fatal("cancelled send accepted")
	}
	for _, file := range files {
		if content, err := os.ReadFile(file); err != nil || !strings.Contains(string(content), "example.invalid") {
			t.Fatal("message is unreadable or recipient is missing", err)
		}
	}
}

func TestLocalMailboxRejectsInvalidConfiguration(t *testing.T) {
	if _, err := NewLocalMailbox("relative", "dev@example.invalid", "http://127.0.0.1:5175"); err == nil {
		t.Fatal("relative directory accepted")
	}
	if _, err := NewLocalMailbox(t.TempDir(), "invalid", "http://127.0.0.1:5175"); err == nil {
		t.Fatal("invalid sender accepted")
	}
}
