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


async def discover_devices_via_mcp() -> list[dict[str, Any]] | None:
    """
    Discover devices using MCP tools instead of direct WebSocket/REST calls.

    Calls ha_get_states for entity data and ha_get_areas / ha_get_devices
    for area mapping, then cross-references to produce the same device
    list format as ha_client.discover_devices().

    Returns None if MCP is unavailable or the call fails (caller should
    fall back to ha_client's WebSocket/REST path).
    """
    tools = await get_mcp_tools()
    if not tools:
        return None

    tool_map = {t.name: t for t in tools}

    try:
        # Fetch all entity states via MCP
        if "ha_get_states" not in tool_map:
            logger.warning("ha_get_states not available in MCP tools")
            return None
        states_result = await tool_map["ha_get_states"].ainvoke({})
        states = _parse_json_result(states_result)
        if not states:
            logger.warning("ha_get_states returned no data")
            return None

        # Fetch areas via MCP (area_id -> name)
        area_id_to_name: dict[str, str] = {}
        if "ha_get_areas" in tool_map:
            areas_result = await tool_map["ha_get_areas"].ainvoke({})
            areas_data = _parse_json_result(areas_result)
            if isinstance(areas_data, list):
                for a in areas_data:
                    if isinstance(a, dict) and "area_id" in a and "name" in a:
                        area_id_to_name[a["area_id"]] = a["name"]

        # Fetch devices via MCP (device_id -> area_id)
        device_id_to_area: dict[str, str] = {}
        if "ha_get_devices" in tool_map:
            devices_result = await tool_map["ha_get_devices"].ainvoke({})
            devices_data = _parse_json_result(devices_result)
            if isinstance(devices_data, list):
                for d in devices_data:
                    if isinstance(d, dict) and "id" in d:
                        area_id = d.get("area_id") or ""
                        device_id_to_area[d["id"]] = area_id_to_name.get(area_id, "")

        # Build discovered devices list from states
        discovered: list[dict[str, Any]] = []
        seen: set[str] = set()

        for row in states:
            entity_id = row.get("entity_id")
            if not entity_id or "." not in entity_id:
                continue
            domain = entity_id.split(".", 1)[0]
            if domain in {"automation", "calendar"}:
                continue
            if entity_id in seen:
                continue

            attrs = row.get("attributes") or {}
            # Try direct area from attributes, then device-derived area
            direct_area = (
                attrs.get("area_name")
                or attrs.get("area")
                or attrs.get("room")
                or attrs.get("suggested_area")
                or attrs.get("area_id")
            )
            area = direct_area or None

            discovered.append(
                {
                    "entity_id": entity_id,
                    "name": attrs.get("friendly_name") or entity_id,
                    "domain": domain,
                    "area": area,
                    "state": row.get("state"),
                }
            )
            seen.add(entity_id)

        discovered.sort(key=lambda d: d["entity_id"])
        logger.info("MCP device discovery: %d devices, %d areas, %d devices-with-areas",
                    len(discovered), len(area_id_to_name), len(device_id_to_area))
        return discovered

    except Exception as exc:
        logger.warning("MCP device discovery failed: %s", exc)
        return None


def _parse_json_result(result: Any) -> Any:
    """Parse a tool result that may be a JSON string, dict, or list."""
    if isinstance(result, (dict, list)):
        return result
    if isinstance(result, str):
        import json
        try:
            return json.loads(result)
        except json.JSONDecodeError:
            return None
    return None