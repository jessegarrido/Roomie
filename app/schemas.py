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


class CreatePlacementRequest(BaseModel):
    entity_id: str
    label: Optional[str] = None
    x_m: float
    y_m: float


class CreateArchitecturalElementRequest(BaseModel):
    kind: str = "wall"
    x_m: float
    y_m: float
    length_m: Optional[float] = None
    thickness_m: Optional[float] = None
    orientation: str = "vertical"


class UpdateArchitecturalElementRequest(BaseModel):
    kind: Optional[str] = None
    orientation: Optional[str] = None
    x_m: Optional[float] = None
    y_m: Optional[float] = None
    length_m: Optional[float] = None
    thickness_m: Optional[float] = None


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


class ArchitecturalElementOut(BaseModel):
    id: int
    kind: str
    orientation: str
    length_m: float
    thickness_m: float
    x_m: float
    y_m: float


class RoomMap(BaseModel):
    room: RoomOut
    placements: List[PlacementOut]
    architectural_elements: List[ArchitecturalElementOut] = []


class ChatResponse(BaseModel):
    reply: str
    map_data: Optional[RoomMap] = None
