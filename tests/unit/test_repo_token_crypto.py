from cryptography.fernet import Fernet
import services.db as db


def test_roundtrip_with_key(monkeypatch):
    key = Fernet.generate_key().decode()
    monkeypatch.setattr(db, "_TOKEN_KEY", key)
    monkeypatch.setattr(db, "_fernet", Fernet(key.encode()))
    enc = db._encrypt_token("ghp_secret123")
    assert enc != "ghp_secret123"
    assert db._decrypt_token(enc) == "ghp_secret123"


def test_legacy_plaintext_falls_through(monkeypatch):
    key = Fernet.generate_key().decode()
    monkeypatch.setattr(db, "_TOKEN_KEY", key)
    monkeypatch.setattr(db, "_fernet", Fernet(key.encode()))
    assert db._decrypt_token("ghp_legacy_plaintext") == "ghp_legacy_plaintext"


def test_no_key_configured_is_noop(monkeypatch):
    monkeypatch.setattr(db, "_fernet", None)
    assert db._encrypt_token("ghp_x") == "ghp_x"
    assert db._decrypt_token("ghp_x") == "ghp_x"
