import importlib
import os
import sys
import tempfile
from pathlib import Path
from typing import Iterator

from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


class _FakeEmbeddingItem:
    def __init__(self, embedding: list[float]):
        self.embedding = embedding


class _FakeEmbeddingResponse:
    def __init__(self, embedding: list[float]):
        self.data = [_FakeEmbeddingItem(embedding)]


class _FakeEmbeddingsApi:
    def create(self, model: str, input: str) -> _FakeEmbeddingResponse:
        return _FakeEmbeddingResponse([0.1, 0.2, 0.3, 0.4])


class _FakeDelta:
    def __init__(self, content: str):
        self.content = content


class _FakeChoice:
    def __init__(self, content: str):
        self.delta = _FakeDelta(content)


class _FakeChunk:
    def __init__(self, content: str):
        self.choices = [_FakeChoice(content)]


class _FakeChatCompletionsApi:
    def create(self, model: str, temperature: float, stream: bool, messages: list[dict]) -> Iterator[_FakeChunk]:
        response = "Berdasarkan pengetahuan umum, ini adalah jawaban audit yang sehat."
        yield _FakeChunk(response)


class _FakeChatApi:
    def __init__(self):
        self.completions = _FakeChatCompletionsApi()


class _FakeOpenAIClient:
    def __init__(self):
        self.embeddings = _FakeEmbeddingsApi()
        self.chat = _FakeChatApi()


def assert_status(response, expected: int, label: str) -> None:
    if response.status_code != expected:
        raise AssertionError(f"{label} expected {expected}, got {response.status_code}: {response.text}")


def main() -> None:
    fd, db_path = tempfile.mkstemp(prefix="chat_ai_smoke_", suffix=".db")
    os.close(fd)
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ["OPENAI_API_KEY"] = "test-key"
    os.environ["APP_BASE_URL"] = "http://localhost:3000"
    os.environ["ADMIN_EMAILS"] = "owner@example.com"

    import backend.main as app_main

    importlib.reload(app_main)
    app_main.get_openai_client = lambda: _FakeOpenAIClient()
    app_main.create_embedding = lambda text: [0.1, 0.2, 0.3, 0.4]

    client = TestClient(app_main.app)

    owner = {"name": "Owner", "email": "owner@example.com", "password": "Passw0rd!123"}
    member = {"name": "Member", "email": "member@example.com", "password": "Passw0rd!123"}

    owner_register = client.post("/auth/register", json=owner)
    assert_status(owner_register, 200, "owner register")
    owner_headers = {"Authorization": f"Bearer {owner_register.json()['token']}"}

    member_register = client.post("/auth/register", json=member)
    assert_status(member_register, 200, "member register")
    member_headers = {"Authorization": f"Bearer {member_register.json()['token']}"}

    assert_status(client.get("/health"), 200, "health")
    assert_status(client.get("/auth/me", headers=owner_headers), 200, "auth me")
    assert_status(client.get("/admin/analytics", headers=owner_headers), 200, "admin analytics")
    assert_status(client.get("/system/email-worker-status", headers=owner_headers), 200, "email worker status")

    workspace = client.get("/workspaces", headers=owner_headers).json()[0]
    workspace_id = workspace["id"]

    assert_status(
        client.post(
            f"/workspaces/{workspace_id}/settings",
            headers=owner_headers,
            json={"monthly_token_quota": 123456},
        ),
        200,
        "partial settings update",
    )

    budget_response = client.post(
        f"/workspaces/{workspace_id}/department-budgets",
        headers=owner_headers,
        json={"department": "Ops", "monthly_budget_usd": 100, "alert_threshold_ratio": 0.8},
    )
    assert_status(budget_response, 200, "upsert department budget")
    budget_id = budget_response.json()[0]["id"]
    assert_status(
        client.delete(
            f"/workspaces/{workspace_id}/department-budgets/{budget_id}",
            headers=owner_headers,
        ),
        200,
        "delete department budget",
    )

    invite_response = client.post(
        f"/workspaces/{workspace_id}/members",
        headers=owner_headers,
        json={"email": "member@example.com", "role": "member"},
    )
    assert_status(invite_response, 200, "invite member")

    invites = client.get("/workspace-invitations", headers=member_headers)
    assert_status(invites, 200, "member invitation inbox")
    invite_token = invites.json()[0]["token"]
    assert_status(client.get(f"/workspace-invitations/{invite_token}"), 200, "public invite detail")
    assert_status(
        client.post(f"/workspace-invitations/{invite_token}/accept", headers=member_headers),
        200,
        "accept invite",
    )

    assert_status(
        client.post(
            f"/workspaces/{workspace_id}/members/member@example.com/metadata",
            headers=owner_headers,
            json={"department": "Ops", "cost_center": "BW-01"},
        ),
        200,
        "update member metadata",
    )
    assert_status(
        client.post(
            f"/workspaces/{workspace_id}/members/member@example.com/role",
            headers=owner_headers,
            json={"role": "admin"},
        ),
        200,
        "update member role",
    )

    conversation = client.post("/conversations", headers=owner_headers)
    assert_status(conversation, 200, "create conversation")
    conversation_id = conversation.json()["id"]

    temp_txt = f"{db_path}.txt"
    with open(temp_txt, "w", encoding="utf-8") as handle:
        handle.write("SOP Pengadaan\\nLangkah 1 validasi kebutuhan. Langkah 2 persetujuan manajer.")
    with open(temp_txt, "rb") as handle:
        upload = client.post(
            f"/conversations/{conversation_id}/documents",
            headers=owner_headers,
            files={"file": ("sample.txt", handle, "text/plain")},
        )
    assert_status(upload, 200, "upload document")
    document_id = upload.json()["id"]

    assert_status(client.get(f"/workspaces/{workspace_id}/documents", headers=owner_headers), 200, "workspace documents")

    chat = client.post(
        f"/conversations/{conversation_id}/chat",
        headers=owner_headers,
        json={"content": "Ringkas isi dokumen ini."},
    )
    assert_status(chat, 200, "chat endpoint")

    api_key_create = client.post(
        f"/workspaces/{workspace_id}/api-keys",
        headers=owner_headers,
        json={"label": "integration"},
    )
    assert_status(api_key_create, 200, "create api key")
    api_key = api_key_create.json()["api_key"]
    api_key_id = api_key_create.json()["item"]["id"]
    api_key_headers = {"X-API-Key": api_key, "X-Workspace-Id": workspace_id}
    assert_status(
        client.get(f"/workspaces/{workspace_id}/documents", headers=api_key_headers),
        200,
        "documents via api key",
    )
    assert_status(
        client.get(f"/workspaces/{workspace_id}/settings", headers=api_key_headers),
        403,
        "human-only settings blocked for api key",
    )
    assert_status(
        client.delete(f"/workspaces/{workspace_id}/api-keys/{api_key_id}", headers=owner_headers),
        200,
        "delete api key",
    )

    assert_status(
        client.post(f"/workspaces/{workspace_id}/subscription/checkout-mock", headers=owner_headers),
        200,
        "mock checkout",
    )
    assert_status(
        client.post(
            "/billing/webhooks/stripe",
            headers={"Stripe-Signature": "whsec_mock"},
            json={"event_type": "customer.subscription.updated", "workspace_id": workspace_id, "status": "active"},
        ),
        200,
        "stripe webhook",
    )

    assert_status(client.post(f"/conversations/{conversation_id}/reset", headers=owner_headers), 200, "reset conversation")
    assert_status(client.delete(f"/documents/{document_id}", headers=owner_headers), 200, "delete document")
    assert_status(client.delete(f"/conversations/{conversation_id}", headers=owner_headers), 200, "delete conversation")

    print("SMOKE_AUDIT_OK")


if __name__ == "__main__":
    main()
