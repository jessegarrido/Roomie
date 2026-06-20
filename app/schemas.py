from typing import Optional, List
from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str


class DeviceOut(BaseModel):
    entity_id: str
    name: str
    domain: str
    area: Optional[str] = None


class RoomCreate(BaseModel):
    name: str
    width_m: float
    height_m: float


class PlaceDeviceInput(BaseModel):
    room_name: str
    entity_id: str
    label: Optional[str] = None
    x_m: float
    y_m: float


class MoveDeviceInput(BaseModel):
    placement_id: int
    x_m: float
    y_m: float


class MovePlacementRequest(BaseModel):
    x_m: float
    y_m: float


class RoomOut(BaseModel):
    id: int
    name: str
    width_m: float
    height_m: float


class PlacementOut(BaseModel):
    id: int
    entity_id: str
    label: str
    x_m: float
    y_m: float


class RoomMap(BaseModel):
    room: RoomOut
    placements: List[PlacementOut]


class ChatResponse(BaseModel):
    reply: str
    map_data: Optional[RoomMap] = None
