from fastapi.testclient import TestClient

from app.main import create_app


def test_health():
    client = TestClient(create_app())
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_openapi_is_published():
    client = TestClient(create_app())
    spec = client.get("/openapi.json").json()
    assert spec["openapi"].startswith("3.")
    assert "/api/v1/me" in spec["paths"]
