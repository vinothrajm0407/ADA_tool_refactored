"""API keys are managed by a signed-in person; an API key itself can't mint or revoke keys."""
import pytest

from tests.conftest import auth_headers

API_KEY = {"Authorization": "Bearer ada_leaked-ci-key"}


@pytest.mark.integration
class TestApiKeyManagement:
    def test_signed_in_user_creates_key(self, client, db_mock):
        db_mock.create_api_key.return_value = {"id": 1, "label": "ci", "key": "ada_new"}
        res = client.post("/api/api-keys", json={"label": "ci"}, headers=auth_headers())
        assert res.status_code == 200 and res.get_json()["key"]["key"] == "ada_new"

    def test_api_key_cannot_create_key(self, client, db_mock):
        db_mock.get_user_id_by_api_key.return_value = 1
        res = client.post("/api/api-keys", json={"label": "more"}, headers=API_KEY)
        assert res.status_code == 403
        db_mock.create_api_key.assert_not_called()

    def test_api_key_cannot_revoke_key(self, client, db_mock):
        db_mock.get_user_id_by_api_key.return_value = 1
        res = client.delete("/api/api-keys/5", headers=API_KEY)
        assert res.status_code == 403
        db_mock.revoke_api_key.assert_not_called()
