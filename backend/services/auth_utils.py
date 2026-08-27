import secrets


def generate_verify_token() -> str:
    """Return a cryptographically random, URL-safe 64-character token."""
    return secrets.token_urlsafe(48)
