import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core import auth
from app.core.auth import CurrentUser, decode_token, get_current_user, require_role
from app.core.config import Settings
from app.main import create_app

SETTINGS = Settings(supabase_url="https://example.supabase.co")


class FakeJWKS:
    """Stands in for PyJWKClient: returns our test public key."""

    def __init__(self, public_key):
        self._key = public_key

    def get_signing_key_from_jwt(self, token):
        class K:
            key = self._key

        return K()


@pytest.fixture(scope="module")
def keypair():
    private = ec.generate_private_key(ec.SECP256R1())
    return private, private.public_key()


def make_token(private, **overrides):
    now = int(time.time())
    claims = {
        "sub": "11111111-1111-1111-1111-111111111111",
        "email": "pooja@example.com",
        "aud": "authenticated",
        "iss": SETTINGS.jwt_issuer,
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return jwt.encode(claims, private, algorithm="ES256", headers={"kid": "test"})


def test_valid_token_decodes(keypair):
    private, public = keypair
    claims = decode_token(make_token(private), SETTINGS, FakeJWKS(public))
    assert claims["sub"] == "11111111-1111-1111-1111-111111111111"


@pytest.mark.parametrize(
    "overrides",
    [
        {"exp": int(time.time()) - 10},
        {"aud": "anon"},
        {"iss": "https://evil.example.com/auth/v1"},
    ],
)
def test_bad_claims_rejected(keypair, overrides):
    private, public = keypair
    with pytest.raises(HTTPException) as exc:
        decode_token(make_token(private, **overrides), SETTINGS, FakeJWKS(public))
    assert exc.value.status_code == 401


def test_token_signed_by_other_key_rejected(keypair):
    _, public = keypair
    other = ec.generate_private_key(ec.SECP256R1())
    with pytest.raises(HTTPException) as exc:
        decode_token(make_token(other), SETTINGS, FakeJWKS(public))
    assert exc.value.status_code == 401


def test_missing_token_is_401():
    client = TestClient(create_app())
    assert client.get("/api/v1/me").status_code == 401


def test_require_role_blocks_and_allows():
    app = create_app()
    from fastapi import Depends

    @app.get("/facilitator-only")
    def only(user: CurrentUser = Depends(require_role("facilitator"))):
        return {"ok": True}

    client = TestClient(app)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id="u1", email=None, roles={"student"})
    assert client.get("/facilitator-only").status_code == 403
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id="u1", email=None, roles={"facilitator"})
    assert client.get("/facilitator-only").status_code == 200


def test_get_current_user_loads_roles(keypair, monkeypatch):
    private, public = keypair
    monkeypatch.setattr(auth, "_jwks_client", lambda url: FakeJWKS(public))
    monkeypatch.setattr(auth, "get_roles", lambda uid: {"student"})
    creds = type("C", (), {"scheme": "Bearer", "credentials": make_token(private)})()
    user = get_current_user(creds, SETTINGS)
    assert user.roles == {"student"}
    assert user.email == "pooja@example.com"
