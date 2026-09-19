package oidc

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"testing"
)

// EC-Schlüsselmaterial in jwkToPublicKey (ES256/384/512). Die Umstellung auf
// ecdsa.ParseUncompressedPublicKey (Dependency-Sweep 2026-09-19) hat zwei
// Eigenschaften, die vorher niemand geprüft hat: Punkte außerhalb der Kurve
// werden abgelehnt, und zu kurze Koordinaten werden links aufgefüllt statt
// verworfen.

// ecJWK baut ein EC-JWK aus einem unkomprimierten SEC-1-Punkt. Mit strip
// werden führende Nullbytes aus x und y entfernt — die Form, die manche
// Provider liefern, obwohl RFC 7518 §6.2.1.2 die volle Koordinatenlänge
// verlangt.
func ecJWK(t *testing.T, crv string, point []byte, strip bool) JWK {
	t.Helper()
	coordLen := (len(point) - 1) / 2
	x, y := point[1:1+coordLen], point[1+coordLen:]
	if strip {
		x = bytes.TrimLeft(x, "\x00")
		y = bytes.TrimLeft(y, "\x00")
	}
	return JWK{
		Kty: "EC",
		Kid: "ec-1",
		Alg: "ES256",
		Crv: crv,
		X:   base64.RawURLEncoding.EncodeToString(x),
		Y:   base64.RawURLEncoding.EncodeToString(y),
	}
}

// mustECPoint liefert einen frischen P-256-Schlüssel samt unkomprimierter
// Punktkodierung.
func mustECPoint(t *testing.T) (*ecdsa.PrivateKey, []byte) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	point, err := priv.PublicKey.Bytes()
	if err != nil {
		t.Fatalf("PublicKey.Bytes: %v", err)
	}
	return priv, point
}

// Ein wohlgeformtes EC-JWK rekonstruiert exakt denselben Public Key.
func TestJWKToPublicKeyECValid(t *testing.T) {
	priv, point := mustECPoint(t)
	got, err := jwkToPublicKey(ecJWK(t, "P-256", point, false))
	if err != nil {
		t.Fatalf("jwkToPublicKey: %v", err)
	}
	pub, ok := got.(*ecdsa.PublicKey)
	if !ok {
		t.Fatalf("got %T, want *ecdsa.PublicKey", got)
	}
	if !pub.Equal(&priv.PublicKey) {
		t.Error("rekonstruierter Key weicht vom Original ab")
	}
}

// Eine Koordinate mit abgeschnittenen führenden Nullbytes muss weiterhin
// verifizieren — sonst fällt jeder Provider aus, der x/y nicht auf die feste
// Kurvenlänge auffüllt.
func TestJWKToPublicKeyECShortCoordinate(t *testing.T) {
	const tries = 2000
	var priv *ecdsa.PrivateKey
	var point []byte
	for range tries {
		k, p := mustECPoint(t)
		if p[1] == 0 || p[1+32] == 0 {
			priv, point = k, p
			break
		}
	}
	if priv == nil {
		t.Skipf("kein P-256-Schlüssel mit führendem Nullbyte in %d Versuchen", tries)
	}
	jwk := ecJWK(t, "P-256", point, true)
	rawX, err := base64.RawURLEncoding.DecodeString(jwk.X)
	if err != nil {
		t.Fatalf("decode x: %v", err)
	}
	rawY, err := base64.RawURLEncoding.DecodeString(jwk.Y)
	if err != nil {
		t.Fatalf("decode y: %v", err)
	}
	if len(rawX) == 32 && len(rawY) == 32 {
		t.Fatal("Testaufbau greift nicht: beide Koordinaten sind voll lang")
	}
	got, err := jwkToPublicKey(jwk)
	if err != nil {
		t.Fatalf("jwkToPublicKey mit gekürzter Koordinate: %v", err)
	}
	pub, ok := got.(*ecdsa.PublicKey)
	if !ok {
		t.Fatalf("got %T, want *ecdsa.PublicKey", got)
	}
	if !pub.Equal(&priv.PublicKey) {
		t.Error("links aufgefüllter Key weicht vom Original ab")
	}
}

// Ein Punkt, der nicht auf der Kurve liegt, wird abgelehnt. Genau diese
// Prüfung fehlte der direkten X/Y-Befüllung (SA1019, deprecated seit Go 1.26).
func TestJWKToPublicKeyECOffCurveRejected(t *testing.T) {
	_, point := mustECPoint(t)
	bad := append([]byte(nil), point...)
	bad[len(bad)-1] ^= 0x01
	if _, err := jwkToPublicKey(ecJWK(t, "P-256", bad, false)); err == nil {
		t.Fatal("want reject für Punkt außerhalb der Kurve, got nil error")
	}
}

// Eine überlange Koordinate ist ein Fehler, kein Anlass zum Kürzen: sonst
// akzeptierte die Verifikation einen anderen Key als den gesendeten.
func TestJWKToPublicKeyECOversizedCoordinateRejected(t *testing.T) {
	_, point := mustECPoint(t)
	jwk := ecJWK(t, "P-256", point, false)
	rawX, err := base64.RawURLEncoding.DecodeString(jwk.X)
	if err != nil {
		t.Fatalf("decode x: %v", err)
	}
	jwk.X = base64.RawURLEncoding.EncodeToString(append([]byte{0x00}, rawX...))
	if _, err := jwkToPublicKey(jwk); err == nil {
		t.Fatal("want reject für 33-Byte-Koordinate, got nil error")
	}
}
