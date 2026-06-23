"""
MCP client for connecting to the Home Assistant MCP server (ha-mcp).

Uses langchain-mcp-adapters to load MCP tools as LangChain-compatible tools,
then filters to the subset relevant to this project's room-planning agent.

Environment variables:
  HA_MCP_COMMAND  – executable to launch ha-mcp (default: "uvx")
  HA_MCP_ARGS      – space-separated args (default: "ha-mcp")
  HA_BASE_URL      – Home Assistant URL (passed to ha-mcp as HA_URL)
  HA_TOKEN         – Home Assistant long-lived access token
  HA_USE_MOCK      – when "true" (default), skip MCP and use mock devices
  MCP_TOOL_FILTER  – comma-separated tool name prefixes to keep (optional)
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tool-name filter – only keep MCP tools whose names start with one of these
# prefixes.  This prevents 84+ ha-mcp tools from overwhelming the LLM context.
# ---------------------------------------------------------------------------
_DEFAULT_TOOL_PREFIXES: tuple[str, ...] = (
    "ha_get_state",         # entity state(s)
    "ha_search_entities",   # semantic entity search
    "ha_get_overview",      # system overview (areas, devices, entities)
    "ha_call_service",      # call a HA service (turn_on, turn_off, etc.)
    "ha_get_history",       # historical state data
    "ha_get_states",        # bulk entity states
    "ha_get_areas",         # list HA areas
    "ha_get_devices",       # list HA devices
    "ha_get_domains",       # list HA domains
    "ha_get_services",      # list available HA services
)

# Cache so we only connect once per process lifetime
_mcp_tools_cache: list[Any] | None = None
_mcp_client: Any | None = None


def _should_use_mock() -> bool:
    """Return True if MCP should be skipped in favour of mock devices."""
    raw = os.getenv("HA_USE_MOCK", "true")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _build_server_config() -> dict[str, Any]:
    """Build the MultiServerMCPClient configuration for ha-mcp via stdio."""
    command = os.getenv("HA_MCP_COMMAND", "uvx")
    args_str = os.getenv("HA_MCP_ARGS", "ha-mcp")
    args = args_str.split()

    env: dict[str, str] = {}
    ha_url = os.getenv("HA_BASE_URL", "")
    ha_token = os.getenv("HA_TOKEN", "")
    if ha_url:
        env["HA_URL"] = ha_url
    if ha_token:
        env["HA_TOKEN"] = ha_token

    return {
        "home-assistant": {
            "command": command,
            "args": args,
            "env": env,
            "transport": "stdio",
        }
    }


def _filter_tools(tools: list[Any]) -> list[Any]:
    """Keep only MCP tools whose names match the configured prefixes."""
    raw_filter = os.getenv("MCP_TOOL_FILTER", "")
    if raw_filter.strip():
        prefixes = tuple(p.strip() for p in raw_filter.split(",") if p.strip())
    else:
        prefixes = _DEFAULT_TOOL_PREFIXES

    kept = [t for t in tools if getattr(t, "name", "").startswith(prefixes)]
    logger.info("MCP tool filter: %d/%d tools kept (prefixes=%s)", len(kept), len(tools), prefixes)
    return kept


async def get_mcp_tools() -> list[Any]:
    """
    Return LangChain-compatible tools from the ha-mcp MCP server.

    On first call, creates a MultiServerMCPClient connected via stdio,
    loads tools, filters them, and caches the result for subsequent calls.

    Returns an empty list if:
    - HA_USE_MOCK is true (default)
    - ha-mcp server cannot be reached
    - No tools match the filter
    """
    global _mcp_tools_cache, _mcp_client

    if _should_use_mock():
        logger.debug("MCP skipped – HA_USE_MOCK is true")
        return []

    if _mcp_tools_cache is not None:
        return _mcp_tools_cache

    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient

        config = _build_server_config()
        logger.info("Connecting to ha-mcp via stdio: %s %s", config["home-assistant"]["command"],
                    config["home-assistant"]["args"])

        _mcp_client = MultiServerMCPClient(config)
        all_tools = await _mcp_client.get_tools()

        if not all_tools:
            logger.warning("ha-mcp returned no tools")
            _mcp_tools_cache = []
            return _mcp_tools_cache

        _mcp_tools_cache = _filter_tools(all_tools)
        logger.info("Loaded %d MCP tools from ha-mcp: %s", len(_mcp_tools_cache),
                    [t.name for t in _mcp_tools_cache])
        return _mcp_tools_cache

    except ImportError:
        logger.warning("langchain-mcp-adapters not installed; MCP tools unavailable")
        _mcp_tools_cache = []
        return _mcp_tools_cache
    except Exception as exc:
        logger.warning("Failed to connect to ha-mcp server: %s", exc)
        _mcp_tools_cache = []
        return _mcp_tools_cache


def reset_mcp_cache() -> None:
    """Clear the MCP tools cache (useful for testing)."""
    global _mcp_tools_cache, _mcp_client
    _mcp_tools_cache = None
    _mcp_client = None