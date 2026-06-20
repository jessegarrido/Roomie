from typing import Optional
from sqlmodel import SQLModel, Field


class Room(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    width_m: float
    height_m: float


class DevicePlacement(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    room_id: int = Field(index=True)
    entity_id: str = Field(index=True)
    label: str
    x_m: float
    y_m: float


class ArchitecturalElement(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    room_id: int = Field(index=True)
    kind: str = Field(default="wall", index=True)
    orientation: str = Field(default="vertical", index=True)
    length_m: float
    thickness_m: float
    x_m: float
    y_m: float
