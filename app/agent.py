import logging
import os
import json
from typing import Any

from langchain.tools import tool
from langchain_openai import ChatOpenAI
from langchain.agents import create_openai_functions_agent, AgentExecutor
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder

from .tools import (
    tool_create_room,
    tool_discover_devices,
    tool_list_rooms,
    tool_move_device,
    tool_place_device,
    tool_render_room_map,
)

logger = logging.getLogger(__name__)

# GitHub Models configuration
GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com"
GITHUB_MODEL = "gpt-4o"


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


TOOLS = [discover_devices, create_room, list_rooms, place_device, move_device, render_room_map]


def process_chat_with_langchain(user_message: str) -> dict:
    """
    Process a chat message using LangChain agent with GitHub Models GPT-4o.
    Returns reply and optional map_data.
    """
    github_token = os.getenv("GITHUB_TOKEN")
    if not github_token:
        logger.warning("GITHUB_TOKEN not set; returning error")
        return {"reply": "GitHub token not configured."}

    try:
        # Initialize GPT-4o model via GitHub Models
        llm = ChatOpenAI(
            model=GITHUB_MODEL,
            api_key=github_token,
            base_url=GITHUB_MODELS_BASE_URL,
            temperature=0,
        )

        # Create agent with system prompt
        system_prompt = ChatPromptTemplate.from_messages([
            ("system", (
                "You are a helpful Home Assistant room planner agent. "
                "Help users discover devices, create rooms, and place devices on room maps. "
                "Use the tools to execute user requests. "
                "Be concise and user-friendly in responses."
                "Interpret measurements as feet unless otherwise specified."
            )),
            ("user", "{input}"),
            MessagesPlaceholder(variable_name="agent_scratchpad"),
        ])

        # Create agent
        agent = create_openai_functions_agent(llm, TOOLS, system_prompt)
        agent_executor = AgentExecutor(
            agent=agent,
            tools=TOOLS,
            verbose=True,
            max_iterations=5,
            return_intermediate_steps=True,
        )

        logger.info("LangChain agent (GitHub Models) processing: %s", user_message)

        # Run agent
        result = agent_executor.invoke({"input": user_message})
        reply = result.get("output", "")

        # Check if map data was generated
        map_data = None
        intermediate_steps = result.get("intermediate_steps", [])
        if "render_room_map" in str(intermediate_steps):
            # Tool observations may arrive as dicts or JSON strings depending on LangChain internals.
            for step in intermediate_steps:
                action = step[0] if len(step) > 0 else None
                observation = step[1] if len(step) > 1 else None
                if not getattr(action, "tool", None) == "render_room_map":
                    continue

                if isinstance(observation, dict) and "room" in observation:
                    map_data = observation
                    break

                if isinstance(observation, str):
                    try:
                        parsed = json.loads(observation)
                        if isinstance(parsed, dict) and "room" in parsed:
                            map_data = parsed
                            break
                    except json.JSONDecodeError:
                        logger.debug("render_room_map observation was not JSON")

        logger.info("LangChain agent (GitHub Models) output: %s", reply)
        return {"reply": reply, "map_data": map_data}

    except Exception as e:
        logger.error("Error processing chat with GitHub Models LangChain: %s", e)
        return {"reply": f"Error: {str(e)}"}
