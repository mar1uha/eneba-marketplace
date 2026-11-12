package auth

import (
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Each argon2id hash holds argonMemory (19 MiB) while it runs. A burst of 40 sign-ins must not need
// all of that at once: 760 MiB would crash a 512 MB free-tier instance.
func TestConcurrentHashingStaysWithinMemoryBudget(t *testing.T) {
	if testing.Short() {
		t.Skip("stress test")
	}
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)

	var peak atomic.Uint64
	stop, sampled := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(sampled)
		var m runtime.MemStats
		for {
			select {
			case <-stop:
				return
			default:
			}
			runtime.ReadMemStats(&m)
			if m.HeapAlloc > peak.Load() {
				peak.Store(m.HeapAlloc)
			}
			time.Sleep(2 * time.Millisecond)
		}
	}()

	var wg sync.WaitGroup
	for range 40 {
		wg.Go(func() { HashPassword("burst of sign-ins") })
	}
	wg.Wait()
	close(stop)
	<-sampled

	const budget = 160 << 20
	if grew := int64(peak.Load()) - int64(before.HeapAlloc); grew > budget {
		t.Errorf("40 concurrent hashes grew the heap by %d MiB; budget is %d MiB", grew>>20, budget>>20)
	}
}

func TestHashAndVerifyPassword(t *testing.T) {
	hash := HashPassword("correct horse battery")
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("unexpected hash format: %s", hash)
	}
	if hash == HashPassword("correct horse battery") {
		t.Error("two hashes of the same password are identical; salt is not random")
	}
	if ok, err := VerifyPassword("correct horse battery", hash); err != nil || !ok {
		t.Errorf("correct password rejected: ok=%v err=%v", ok, err)
	}
	if ok, _ := VerifyPassword("correct horse batterY", hash); ok {
		t.Error("wrong password accepted")
	}
	if _, err := VerifyPassword("x", "$bcrypt$nope"); err == nil {
		t.Error("malformed hash not reported")
	}
}

func TestNormalizeEmail(t *testing.T) {
	valid := map[string]string{
		"  Ada@Example.COM ":     "ada@example.com",
		"a.b+tag@sub.example.lt": "a.b+tag@sub.example.lt",
	}
	for in, want := range valid {
		if got, err := NormalizeEmail(in); err != nil || got != want {
			t.Errorf("NormalizeEmail(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"", "ada", "ada@localhost", "Ada <ada@example.com>", "@example.com", "ada@@example.com"} {
		if _, err := NormalizeEmail(in); err == nil {
			t.Errorf("NormalizeEmail(%q) accepted an invalid address", in)
		}
	}
}

func TestValidatePassword(t *testing.T) {
	if validatePassword("password", "1234567") == nil {
		t.Error("7-character password accepted")
	}
	if validatePassword("password", "12345678") != nil {
		t.Error("8-character password rejected")
	}
	if validatePassword("password", strings.Repeat("a", 129)) == nil {
		t.Error("129-character password accepted")
	}
}
