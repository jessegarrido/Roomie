import logging
import os
import json
from typing import Any, List

from langchain.tools import tool
from langchain_openai import ChatOpenAI
from langchain.agents import create_agent

from .tools import (
    tool_add_devices_to_room,
    tool_create_room,
    tool_discover_devices,
    tool_generate_embeddings,
    tool_generate_rooms_from_devices,
    tool_insert_fixture,
    tool_inspect_and_assign_devices_to_room,
    tool_list_rooms,
    tool_move_device,
    tool_place_device,
    tool_rename_room_by_name,
    tool_resize_room,
    tool_render_room_map,
)
from .mcp_client import get_mcp_tools

logger = logging.getLogger(__name__)

# OpenCode Go configuration (DeepSeek V4 Pro)
OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1"
OPENCODE_MODEL = "deepseek-v4-flash"


# LangChain tools wrapping backend functions
@tool
def discover_devices() -> dict:
    """Discover all available devices from Home Assistant"""
    devices = tool_discover_devices()
    # Keep tool output compact for model context limits on GitHub Models.
    sample = devices[:40]
    return {
        "count": len(devices),
        "sample_devices": sample,
        "note": "Sample truncated to first 40 devices.",
    }


@tool
def create_room(name: str, width_m: float, height_m: float) -> dict:
    """Create a new room with dimensions in meters"""
    return tool_create_room(name, width_m, height_m)


@tool
def list_rooms() -> dict:
    """List all rooms that have been created"""
    rooms = tool_list_rooms()
    return {"rooms": rooms}


@tool
def place_device(room_name: str, entity_id: str, label: str, x_m: float, y_m: float) -> dict:
    """Place a device in a room at specific coordinates"""
    return tool_place_device(room_name, entity_id, label, x_m, y_m)


@tool
def move_device(placement_id: int, x_m: float, y_m: float) -> dict:
    """Move a device placement to new coordinates"""
    return tool_move_device(placement_id, x_m, y_m)


@tool
def render_room_map(room_name: str) -> dict:
    """Render a map showing room layout and device placements"""
    return tool_render_room_map(room_name)


@tool
def resize_room(room_name: str, width_m: float, height_m: float) -> dict:
    """
    Resize an existing room.
    Existing items keep absolute coordinates; any that fall out of bounds are moved to the room center.
    """
    return tool_resize_room(room_name, width_m, height_m)


@tool
def insert_fixture(
    room_name: str,
    kind: str,
    x_m: float,
    y_m: float,
    length_m: float | None = None,
    rotation_degrees: float = 0.0,
) -> dict:
    """
    Insert a fixture into a room.
    kind must be one of: wall, door, window, stairs, void, desk, sofa, entry, sink, fixture.
    length_m defaults to 3 feet (0.9144m) when omitted.
    rotation_degrees is the rotation angle in degrees (0-360).
    """
    return tool_insert_fixture(
        room_name=room_name,
        kind=kind,
        x_m=x_m,
        y_m=y_m,
        length_m=length_m,
        rotation_degrees=rotation_degrees,
    )


@tool
def generate_embeddings(texts: List[str]) -> dict:
    """
    Generate vector embeddings for a list of text strings using a free Hugging Face model (all-MiniLM-L6-v2).
    Returns embedding vectors suitable for semantic search or similarity calculations.
    """
    return tool_generate_embeddings(texts)


@tool
def rename_room(room_name: str, new_name: str) -> dict:
    """
    Rename an existing room to a new name.
    """
    return tool_rename_room_by_name(room_name, new_name)


@tool
def add_devices_to_room(room_name: str, description: str, max_devices: int = 10) -> dict:
    """
    Search for devices matching a semantic description and place them all in a room at once.
    Evaluates Home Assistant device attributes (name, domain, area) and uses embeddings for
    relevance ranking. Devices are automatically arranged along the room perimeter.
    Returns which devices were placed and their positions.
    """
    return tool_add_devices_to_room(room_name, description, max_devices)


@tool
def inspect_and_assign_devices_to_room(room_name: str, room_description: str = "", max_to_assign: int = 20) -> dict:
    """
    Inspect every discovered Home Assistant device, use AI to decide which ones belong
    in the specified room, and automatically place them. Devices already in the room are skipped.
    Use this when you want the AI to intelligently scan all available devices and assign
    the ones it believes belong in the room. Provide the room name and optionally a description
    of the room's purpose to help the AI make better decisions.
    """
    return tool_inspect_and_assign_devices_to_room(room_name, room_description, max_to_assign)


@tool
def generate_rooms_from_devices(default_width_m: float = 4.0, default_height_m: float = 3.0) -> dict:
    """
    Discover all Home Assistant devices, create rooms based on HA areas and AI evaluation
    of device names, and auto-assign devices to those rooms. Rooms that already exist are
    updated with new devices. New rooms are given default dimensions.
    Use this to bootstrap your room setup from an existing Home Assistant installation.
    """
    return tool_generate_rooms_from_devices(default_width_m, default_height_m)


TOOLS = [
    discover_devices,
    create_room,
    list_rooms,
    place_device,
    move_device,
    insert_fixture,
    generate_embeddings,
    rename_room,
    resize_room,
    render_room_map,
    add_devices_to_room,
    inspect_and_assign_devices_to_room,
    generate_rooms_from_devices,
]


async def process_chat_with_langchain(user_message: str, history: list | None = None) -> dict:
    """
    Process a chat message using LangChain agent with OpenCode DeepSeek V4 Flash.
    Accepts optional conversation history as a list of {"role": "user"/"assistant", "content": "..."} dicts.
    Returns reply and optional map_data.

    Merges local DB tools (rooms, fixtures, placements) with MCP tools from ha-mcp
    (entity states, service calls, history) when HA_USE_MOCK is not true.
    """
    from langchain_core.messages import HumanMessage, AIMessage, ToolMessage

    opencode_token = os.getenv("OPENCODE_API_KEY")
    if not opencode_token:
        logger.warning("OPENCODE_API_KEY not set; returning error")
        return {"reply": "OpenCode API key not configured."}

    try:
        # Initialize DeepSeek V4 Pro via OpenCode Go
        llm = ChatOpenAI(
            model=OPENCODE_MODEL,
            api_key=opencode_token,
            base_url=OPENCODE_BASE_URL,
            temperature=0,
        )

        # Load MCP tools from ha-mcp (returns [] if HA_USE_MOCK=true or connection fails)
        mcp_tools = await get_mcp_tools()
        all_tools = TOOLS + mcp_tools
        logger.info("Agent tools: %d local + %d MCP = %d total", len(TOOLS), len(mcp_tools), len(all_tools))

        # Cap history to last 20 messages to stay within token limits
        MAX_HISTORY = 20
        capped_history = history[-MAX_HISTORY:] if history and len(history) > MAX_HISTORY else (history or [])

        # Build system prompt – adapt based on whether MCP tools are available
        if mcp_tools:
            mcp_hint = (
                "You also have access to Home Assistant MCP tools for live entity states, "
                "service calls (e.g. turning devices on/off), and history queries. "
                "Use ha_get_states or ha_search_entities to discover real HA entities, "
                "ha_call_service to control devices, and ha_get_history for historical data. "
            )
        else:
            mcp_hint = ""

        system_prompt = (
            "You are a helpful Home Assistant room planner agent. "
            "Help users discover devices, create rooms, and place devices on room maps. "
            "Use the tools to execute user requests. "
            "Be concise and user-friendly in responses. "
            "Interpret measurements as feet unless otherwise specified. "
            "When you need to work with devices, use the discover_devices tool first to get the current list. "
            + mcp_hint
        )

        # Create agent using LangChain 1.x create_agent API
        agent = create_agent(
            model=llm,
            tools=all_tools,
            system_prompt=system_prompt,
        )

        logger.info("LangChain agent (OpenCode DeepSeek V4 Pro) processing: %s", user_message)

        # Build the messages list: prior chat history + new user message
        messages = []
        if capped_history:
            for msg in capped_history:
                role = msg.get("role", "")
                content = msg.get("content", "")
                if role == "user":
                    messages.append(HumanMessage(content=content))
                elif role == "assistant":
                    messages.append(AIMessage(content=content))
        messages.append(HumanMessage(content=user_message))

        # Run agent (async because MCP tools are async)
        result = await agent.ainvoke({"messages": messages})

        # Extract reply from the last AIMessage in the output messages
        reply = ""
        output_messages = result.get("messages", [])
        for msg in reversed(output_messages):
            if isinstance(msg, AIMessage) and msg.content:
                reply = msg.content if isinstance(msg.content, str) else str(msg.content)
                break

        # Check if map data was generated – look through ToolMessage objects
        # for render_room_map tool results containing "room" key
        map_data = None
        for msg in output_messages:
            if not isinstance(msg, ToolMessage):
                continue
            # ToolMessage.name contains the tool name
            tool_name = getattr(msg, "name", "") or ""
            if tool_name != "render_room_map":
                continue

            content = msg.content
            if isinstance(content, dict) and "room" in content:
                map_data = content
                break

            if isinstance(content, str):
                try:
                    parsed = json.loads(content)
                    if isinstance(parsed, dict) and "room" in parsed:
                        map_data = parsed
                        break
                except json.JSONDecodeError:
                    logger.debug("render_room_map ToolMessage content was not JSON")

        logger.info("LangChain agent (OpenCode DeepSeek V4 Pro) output: %s", reply)
        return {"reply": reply, "map_data": map_data}

    except Exception as e:
        logger.error("Error processing chat with OpenCode LangChain: %s", e)
        return {"reply": f"Error: {str(e)}"}
