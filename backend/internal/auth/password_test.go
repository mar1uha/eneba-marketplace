package auth

import (
	"strings"
	"testing"
)

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
