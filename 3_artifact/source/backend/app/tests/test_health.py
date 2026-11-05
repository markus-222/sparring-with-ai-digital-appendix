"""Health endpoint tests — proves the test harness works."""

import pytest


@pytest.mark.unit
async def test_health_returns_200(client):
    """GET /health should return 200 with status info."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "llm_provider" in data
    assert "model" in data


@pytest.mark.unit
async def test_health_shows_provider(client):
    """Health endpoint should report the configured LLM provider."""
    response = await client.get("/health")
    data = response.json()
    assert data["llm_provider"] == "anthropic"
