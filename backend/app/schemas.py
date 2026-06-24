from typing import Optional, List
from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    history: List[dict] = []


class DeviceOut(BaseModel):
    entity_id: str
    name: str
    domain: str
    area: Optional[str] = None
    state: Optional[str] = None


class DeviceSearchRequest(BaseModel):
    query: str
    top_k: int = 20


class FloorCreate(BaseModel):
    name: str
    level: int = 1


class FloorOut(BaseModel):
    id: int
    name: str
    level: int


class RoomCreate(BaseModel):
    name: str
    width_m: float
    height_m: float
    floor_id: Optional[int] = None


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


class ResizePlacementRequest(BaseModel):
    size_m: float


class ResizeRoomRequest(BaseModel):
    width_m: float
    height_m: float


class RenameRoomRequest(BaseModel):
    name: str


class RenameFloorRequest(BaseModel):
    name: str


class CreatePlacementRequest(BaseModel):
    entity_id: str
    label: Optional[str] = None
    x_m: float
    y_m: float


class CreateFixtureRequest(BaseModel):
    kind: str = "wall"
    x_m: float
    y_m: float
    length_m: Optional[float] = None
    thickness_m: Optional[float] = None
    rotation_degrees: float = 0.0


class UpdateFixtureRequest(BaseModel):
    kind: Optional[str] = None
    rotation_degrees: Optional[float] = None
    x_m: Optional[float] = None
    y_m: Optional[float] = None
    length_m: Optional[float] = None
    thickness_m: Optional[float] = None


class RoomOut(BaseModel):
    id: int
    name: str
    width_m: float
    height_m: float
    floor_id: Optional[int] = None


class PlacementOut(BaseModel):
    id: int
    entity_id: str
    label: str
    x_m: float
    y_m: float
    size_m: float = 0.1
    state: Optional[str] = None
    domain: Optional[str] = None
    area: Optional[str] = None
    device_type: Optional[str] = None
    device_type_override: Optional[str] = None


class UpdatePlacementTypeRequest(BaseModel):
    device_type: Optional[str] = None


class FixtureOut(BaseModel):
    id: int
    kind: str
    rotation_degrees: float
    length_m: float
    thickness_m: float
    x_m: float
    y_m: float


class RoomMap(BaseModel):
    room: RoomOut
    placements: List[PlacementOut]
    fixtures: List[FixtureOut] = []


class ChatResponse(BaseModel):
    reply: str
    map_data: Optional[RoomMap] = None
