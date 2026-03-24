import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


class DemoFlowTests(unittest.TestCase):
    def setUp(self) -> None:
        fd, db_path = tempfile.mkstemp(prefix="chat_ai_test_", suffix=".db")
        os.close(fd)
        self.db_path = db_path
        self._original_env = os.environ.copy()
        os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
        os.environ["OPENAI_API_KEY"] = "replace_with_real_openai_api_key"
        os.environ["DEMO_AI_MODE"] = "auto"
        os.environ["APP_BASE_URL"] = "http://localhost:3000"
        os.environ["ADMIN_EMAILS"] = "owner@example.com"
        os.environ["AUTO_PROCESS_EMAIL_JOBS"] = "0"
        os.environ["USE_NATIVE_PGVECTOR"] = "1"

        import backend.main as app_main

        self.app_main = importlib.reload(app_main)
        self.client = TestClient(self.app_main.app)

    def tearDown(self) -> None:
        self.client.close()
        os.environ.clear()
        os.environ.update(self._original_env)
        try:
            Path(self.db_path).unlink(missing_ok=True)
        except OSError:
            pass

    def _register_and_login(self, email: str) -> dict[str, str]:
        password = "Passw0rd!123"
        register = self.client.post(
            "/auth/register",
            json={"name": "Owner", "email": email, "password": password},
        )
        self.assertEqual(register.status_code, 200, register.text)
        token = register.json()["token"]
        return {"Authorization": f"Bearer {token}"}

    def test_demo_chat_uses_uploaded_document_context(self) -> None:
        headers = self._register_and_login("owner@example.com")

        create_conversation = self.client.post("/conversations", headers=headers)
        self.assertEqual(create_conversation.status_code, 200, create_conversation.text)
        conversation_id = create_conversation.json()["id"]

        upload = self.client.post(
            f"/conversations/{conversation_id}/documents",
            headers=headers,
            files={
                "file": (
                    "onboarding.txt",
                    (
                        "SOP onboarding karyawan baru mencakup persiapan akun kerja, "
                        "pengenalan SOP keselamatan, penjelasan struktur tim, dan checklist 30 hari pertama."
                    ).encode("utf-8"),
                    "text/plain",
                )
            },
        )
        self.assertEqual(upload.status_code, 200, upload.text)
        self.assertEqual(upload.json()["chunk_count"], 1)

        chat = self.client.post(
            f"/conversations/{conversation_id}/chat",
            headers=headers,
            json={"content": "Ringkas dokumen yang baru diupload jadi poin penting."},
        )
        self.assertEqual(chat.status_code, 200, chat.text)
        self.assertEqual(chat.headers.get("x-ai-mode"), "demo")
        self.assertIn("Berdasarkan dokumen workspace yang tersedia", chat.text)
        self.assertIn("SOP onboarding karyawan baru", chat.text)

    def test_demo_chat_without_documents_gives_clear_guidance(self) -> None:
        headers = self._register_and_login("guidance@example.com")

        create_conversation = self.client.post("/conversations", headers=headers)
        self.assertEqual(create_conversation.status_code, 200, create_conversation.text)
        conversation_id = create_conversation.json()["id"]

        chat = self.client.post(
            f"/conversations/{conversation_id}/chat",
            headers=headers,
            json={"content": "Ringkas dokumen ini."},
        )
        self.assertEqual(chat.status_code, 200, chat.text)
        self.assertEqual(chat.headers.get("x-ai-mode"), "demo")
        self.assertIn("belum ada dokumen workspace", chat.text.lower())
        self.assertIn("upload pdf atau txt", chat.text.lower())

    def test_google_login_creates_account_and_returns_token(self) -> None:
        self.app_main.GOOGLE_CLIENT_ID = "google-client-id"
        self.app_main.verify_google_credential = lambda credential: {
            "email": "googleuser@example.com",
            "email_verified": True,
            "name": "Google User",
            "sub": "google-sub-123",
        }

        response = self.client.post(
            "/auth/google",
            json={"credential": "fake-google-credential"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["token"])
        self.assertEqual(body["user"]["email"], "googleuser@example.com")
        self.assertTrue(body["user"]["email_verified"])


if __name__ == "__main__":
    unittest.main()
