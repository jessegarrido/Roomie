import logging
from time import perf_counter
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .logging_config import configure_logging
from .schemas import ChatRequest, ChatResponse, DeviceOut, RoomMap, RoomOut
from .agent import process_chat_with_langchain
from .tools import tool_discover_devices, tool_list_rooms, tool_render_room_map_by_id

configure_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title="HA Agent Capstone API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    logger.info("Application startup complete")


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    start = perf_counter()
    response = await call_next(request)
    duration_ms = (perf_counter() - start) * 1000
    logger.info(
        "%s %s -> %s (%.1fms)",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/tools")
def list_tools() -> dict:
    return {
        "tools": [
            "discover_devices",
            "create_room",
            "list_rooms",
            "place_device",
            "move_device",
            "render_room_map",
        ]
    }


@app.get("/devices", response_model=list[DeviceOut])
def devices() -> list[DeviceOut]:
    discovered = tool_discover_devices()
    return [DeviceOut(**device) for device in discovered]


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    logger.info("Chat request received: %s", req.message)
    result = process_chat_with_langchain(req.message)
    logger.info("Chat response generated")
    return ChatResponse(**result)


@app.get("/rooms", response_model=list[RoomOut])
def rooms() -> list[RoomOut]:
    rooms_data = tool_list_rooms()
    return [RoomOut(**room) for room in rooms_data]


@app.get("/rooms/{room_id}/map", response_model=RoomMap)
def room_map(room_id: int) -> RoomMap:
    result = tool_render_room_map_by_id(room_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return RoomMap(**result)
