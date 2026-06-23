"""Tests for the MCP client module."""

import os

import pytest

from app.mcp_client import (
    _build_server_config,
    _filter_tools,
    _should_use_mock,
    get_mcp_tools,
    reset_mcp_cache,
)


def test_should_use_mock_defaults_to_true(monkeypatch):
    """HA_USE_MOCK defaults to true so MCP is skipped in test/dev."""
    monkeypatch.delenv("HA_USE_MOCK", raising=False)
    assert _should_use_mock() is True


def test_should_use_mock_false(monkeypatch):
    monkeypatch.setenv("HA_USE_MOCK", "false")
    assert _should_use_mock() is False


def test_build_server_config_defaults(monkeypatch):
    monkeypatch.setenv("HA_BASE_URL", "http://ha.local:8123")
    monkeypatch.setenv("HA_TOKEN", "test-token")
    monkeypatch.delenv("HA_MCP_COMMAND", raising=False)
    monkeypatch.delenv("HA_MCP_ARGS", raising=False)

    config = _build_server_config()
    assert "home-assistant" in config
    ha = config["home-assistant"]
    assert ha["command"] == "uvx"
    assert ha["args"] == ["ha-mcp"]
    assert ha["transport"] == "stdio"
    assert ha["env"]["HA_URL"] == "http://ha.local:8123"
    assert ha["env"]["HA_TOKEN"] == "test-token"


def test_build_server_config_custom_command(monkeypatch):
    monkeypatch.setenv("HA_MCP_COMMAND", "python")
    monkeypatch.setenv("HA_MCP_ARGS", "-m ha_mcp --stdio")
    monkeypatch.delenv("HA_BASE_URL", raising=False)
    monkeypatch.delenv("HA_TOKEN", raising=False)

    config = _build_server_config()
    ha = config["home-assistant"]
    assert ha["command"] == "python"
    assert ha["args"] == ["-m", "ha_mcp", "--stdio"]
    # env should not include HA_URL/HA_TOKEN if not set
    assert "HA_URL" not in ha["env"]
    assert "HA_TOKEN" not in ha["env"]


class _FakeTool:
    """Minimal stand-in for a LangChain tool with a .name attribute."""

    def __init__(self, name: str):
        self.name = name


def test_filter_tools_keeps_matching_prefixes():
    tools = [
        _FakeTool("ha_get_states"),
        _FakeTool("ha_call_service"),
        _FakeTool("ha_get_history"),
        _FakeTool("ha_get_overview"),
        _FakeTool("ha_config_set_dashboard"),  # should be filtered out
        _FakeTool("ha_manage_hacs"),            # should be filtered out
    ]
    kept = _filter_tools(tools)
    kept_names = [t.name for t in kept]
    assert "ha_get_states" in kept_names
    assert "ha_call_service" in kept_names
    assert "ha_get_history" in kept_names
    assert "ha_get_overview" in kept_names
    assert "ha_config_set_dashboard" not in kept_names
    assert "ha_manage_hacs" not in kept_names


def test_filter_tools_respects_env_override(monkeypatch):
    monkeypatch.setenv("MCP_TOOL_FILTER", "ha_call_service,ha_get_history")
    tools = [
        _FakeTool("ha_get_states"),          # should be filtered out
        _FakeTool("ha_call_service"),         # kept
        _FakeTool("ha_get_history"),         # kept
    ]
    kept = _filter_tools(tools)
    kept_names = [t.name for t in kept]
    assert kept_names == ["ha_call_service", "ha_get_history"]


@pytest.mark.asyncio
async def test_get_mcp_tools_returns_empty_in_mock_mode(monkeypatch):
    """When HA_USE_MOCK is true, get_mcp_tools returns [] without connecting."""
    monkeypatch.setenv("HA_USE_MOCK", "true")
    reset_mcp_cache()
    tools = await get_mcp_tools()
    assert tools == []


def test_reset_mcp_cache():
    """reset_mcp_cache should clear the cache."""
    reset_mcp_cache()
    # Import the module-level vars to verify they're None
    from app import mcp_client
    assert mcp_client._mcp_tools_cache is None
    assert mcp_client._mcp_client is None