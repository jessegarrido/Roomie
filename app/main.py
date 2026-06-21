import logging
from time import perf_counter
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .logging_config import configure_logging
from .schemas import (
    ArchitecturalElementOut,
    ChatRequest,
    ChatResponse,
    CreateArchitecturalElementRequest,
    CreatePlacementRequest,
    DeviceOut,
    FloorCreate,
    FloorOut,
    MovePlacementRequest,
    PlacementOut,
    ResizeRoomRequest,
    RoomMap,
    RoomOut,
    UpdateArchitecturalElementRequest,
)
from .agent import process_chat_with_langchain
from .tools import (
    tool_assign_room_to_floor,
    tool_create_floor,
    tool_delete_architectural_element,
    tool_delete_device,
    tool_delete_floor,
    tool_delete_room,
    tool_discover_devices,
    tool_insert_architectural_element_by_room_id,
    tool_list_floors,
    tool_list_rooms,
    tool_move_device,
    tool_place_device_by_room_id,
    tool_render_room_map_by_id,
    tool_resize_room_by_id,
    tool_update_architectural_element,
)

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
            "insert_architectural_element",
            "resize_room",
            "render_room_map",
            "create_floor",
            "list_floors",
            "delete_floor",
            "assign_room_to_floor",
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


@app.get("/floors", response_model=list[FloorOut])
def floors() -> list[FloorOut]:
    floors_data = tool_list_floors()
    return [FloorOut(**floor) for floor in floors_data]


@app.post("/floors", response_model=FloorOut, status_code=201)
def create_floor(req: FloorCreate) -> FloorOut:
    result = tool_create_floor(name=req.name, level=req.level)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return FloorOut(**result)


@app.delete("/floors/{floor_id}")
def delete_floor(floor_id: int) -> dict:
    result = tool_delete_floor(floor_id=floor_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.patch("/rooms/{room_id}/assign-floor", response_model=RoomOut)
def assign_room_to_floor(room_id: int, floor_id: int | None = None) -> RoomOut:
    result = tool_assign_room_to_floor(room_id=room_id, floor_id=floor_id)
    if "error" in result:
        detail = result["error"]
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)
    return RoomOut(**result)


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


@app.patch("/rooms/{room_id}", response_model=RoomMap)
def resize_room(room_id: int, req: ResizeRoomRequest) -> RoomMap:
    result = tool_resize_room_by_id(room_id=room_id, width_m=req.width_m, height_m=req.height_m)
    if "error" in result:
        detail = result["error"]
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)

    room_map_data = tool_render_room_map_by_id(room_id)
    if "error" in room_map_data:
        raise HTTPException(status_code=404, detail=room_map_data["error"])
    return RoomMap(**room_map_data)


@app.delete("/rooms/{room_id}")
def delete_room(room_id: int) -> dict:
    result = tool_delete_room(room_id=room_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.post("/rooms/{room_id}/placements", response_model=PlacementOut)
def create_placement(room_id: int, req: CreatePlacementRequest) -> PlacementOut:
    label = req.label or req.entity_id
    result = tool_place_device_by_room_id(
        room_id=room_id,
        entity_id=req.entity_id,
        label=label,
        x_m=req.x_m,
        y_m=req.y_m,
    )
    if "error" in result:
        detail = result["error"]
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)
    return PlacementOut(**result)


@app.post("/rooms/{room_id}/architectural-elements", response_model=ArchitecturalElementOut)
def create_architectural_element(room_id: int, req: CreateArchitecturalElementRequest) -> ArchitecturalElementOut:
    result = tool_insert_architectural_element_by_room_id(
        room_id=room_id,
        kind=req.kind,
        x_m=req.x_m,
        y_m=req.y_m,
        length_m=req.length_m,
        thickness_m=req.thickness_m,
        rotation_degrees=req.rotation_degrees,
    )
    if "error" in result:
        detail = result["error"]
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)
    return ArchitecturalElementOut(**result)


@app.patch("/placements/{placement_id}", response_model=PlacementOut)
def move_placement(placement_id: int, req: MovePlacementRequest) -> PlacementOut:
    result = tool_move_device(placement_id=placement_id, x_m=req.x_m, y_m=req.y_m)
    if "error" in result:
        detail = result["error"]
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)
    return PlacementOut(**result)


@app.patch("/architectural-elements/{element_id}", response_model=ArchitecturalElementOut)
def update_architectural_element(element_id: int, req: UpdateArchitecturalElementRequest) -> ArchitecturalElementOut:
    result = tool_update_architectural_element(
        element_id=element_id,
        kind=req.kind,
        rotation_degrees=req.rotation_degrees,
        x_m=req.x_m,
        y_m=req.y_m,
        length_m=req.length_m,
        thickness_m=req.thickness_m,
    )
    if "error" in result:
        detail = result["error"]
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)
    return ArchitecturalElementOut(**result)


@app.delete("/architectural-elements/{element_id}")
def delete_architectural_element(element_id: int) -> dict:
    result = tool_delete_architectural_element(element_id=element_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.delete("/placements/{placement_id}")
def delete_placement(placement_id: int) -> dict:
    result = tool_delete_device(placement_id=placement_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
