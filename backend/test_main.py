import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


class OllamaModelSelectionTests(unittest.TestCase):
    def test_uses_first_installed_model_when_no_model_is_configured(self):
        with patch.object(main, "OLLAMA_MODEL", ""):
            self.assertEqual(main.select_model(["qwen3:8b", "llama3.2"]), "qwen3:8b")

    def test_uses_configured_model_with_implicit_latest_tag(self):
        with patch.object(main, "OLLAMA_MODEL", "qwen3"):
            self.assertEqual(main.select_model(["qwen3:8b", "qwen3:latest"]), "qwen3:latest")

    def test_does_not_fall_back_to_a_different_model_when_one_is_configured(self):
        with patch.object(main, "OLLAMA_MODEL", "llama3.2"):
            self.assertIsNone(main.select_model(["qwen3:8b"]))


class InsightValidationTests(unittest.TestCase):
    def test_parses_valid_recommendations(self):
        insights = main.parse_insights(
            '{"insights":[{"title":"Review time","text":"Eco adds time."}]}'
        )
        self.assertEqual(insights, [{"title": "Review time", "text": "Eco adds time."}])

    def test_rejects_malformed_model_responses(self):
        with self.assertRaises(HTTPException) as error:
            main.parse_insights('{"suggestions":[]}')
        self.assertEqual(error.exception.status_code, 502)

    def test_requires_an_ollama_server_url(self):
        with patch.object(main, "OLLAMA_BASE_URL", ""):
            with self.assertRaises(HTTPException) as error:
                main.ollama_url("/api/tags")
        self.assertEqual(error.exception.status_code, 503)

    def test_health_endpoint_does_not_depend_on_ollama(self):
        response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_unconfigured_ollama_uses_a_clear_demo_fallback_status(self):
        with patch.object(main, "OLLAMA_BASE_URL", ""):
            response = client.get("/api/ollama/status")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["available"])
        self.assertIn("localhost is not reachable", response.json()["error"])

    def test_insight_requests_reject_extra_fields_and_oversized_scenarios(self):
        extra_field_response = client.post(
            "/api/ollama/insights",
            json={"scenario": {}, "model": "untrusted-model"},
        )
        self.assertEqual(extra_field_response.status_code, 422)

        oversized_response = client.post(
            "/api/ollama/insights",
            json={"scenario": {"notes": "x" * (main.MAX_SCENARIO_BYTES + 1)}},
        )
        self.assertEqual(oversized_response.status_code, 413)

    def test_cors_allows_local_frontend_and_blocks_unknown_sites(self):
        allowed = client.get("/health", headers={"Origin": "http://localhost:5173"})
        blocked = client.get("/health", headers={"Origin": "https://untrusted.example"})
        self.assertEqual(allowed.headers["access-control-allow-origin"], "http://localhost:5173")
        self.assertNotIn("access-control-allow-origin", blocked.headers)


if __name__ == "__main__":
    unittest.main()
