package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"sync"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

// argon2id parameters: the OWASP minimum recommendation, sized for a 512 MB free-tier instance.
const (
	argonTime    = 2
	argonMemory  = 19 * 1024 // KiB
	argonThreads = 1
	argonKeyLen  = 32
	saltLen      = 16

	minPasswordLen = 8
	maxPasswordLen = 128

	// maxConcurrentHashes caps argon2id runs in flight. Each holds argonMemory (19 MiB), so a burst
	// of sign-ins waits its turn (under 80 MiB in total) instead of exhausting a 512 MB instance.
	maxConcurrentHashes = 4
)

var hashSlots = make(chan struct{}, maxConcurrentHashes)

func argonKey(password string, salt []byte, time, memory uint32, threads uint8, keyLen uint32) []byte {
	hashSlots <- struct{}{}
	defer func() { <-hashSlots }()
	return argon2.IDKey([]byte(password), salt, time, memory, threads, keyLen)
}

var (
	b64              = base64.RawStdEncoding
	errMalformedHash = errors.New("malformed password hash")
	// dummyHash is verified against when an account does not exist, so a failed
	// sign-in takes the same time whether or not the email is registered.
	dummyHash = sync.OnceValue(func() string { return HashPassword("timing-equalizer") })
)

// HashPassword returns a PHC-format argon2id hash with a random salt.
func HashPassword(password string) string {
	salt := make([]byte, saltLen)
	rand.Read(salt)
	key := argonKey(password, salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads, b64.EncodeToString(salt), b64.EncodeToString(key))
}

// VerifyPassword reads the parameters from the stored hash, so hashes made with older settings still verify.
func VerifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, errMalformedHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, errMalformedHash
	}
	var memory, time uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return false, errMalformedHash
	}
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return false, errMalformedHash
	}
	want, err := b64.DecodeString(parts[5])
	if err != nil {
		return false, errMalformedHash
	}
	got := argonKey(password, salt, time, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

func newToken() string {
	return rand.Text()
}

func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// ValidationError is a user-fixable input problem tied to one form field.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

func NormalizeEmail(raw string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	addr, err := mail.ParseAddress(email)
	at := strings.LastIndex(email, "@")
	if err != nil || addr.Address != email || len(email) > 254 || at < 1 || !strings.Contains(email[at:], ".") {
		return "", &ValidationError{Field: "email", Message: "Enter a valid email address."}
	}
	return email, nil
}

func validatePassword(field, password string) error {
	switch n := utf8.RuneCountInString(password); {
	case n < minPasswordLen:
		return &ValidationError{Field: field, Message: fmt.Sprintf("Use at least %d characters.", minPasswordLen)}
	case n > maxPasswordLen:
		return &ValidationError{Field: field, Message: fmt.Sprintf("Use at most %d characters.", maxPasswordLen)}
	}
	return nil
}
