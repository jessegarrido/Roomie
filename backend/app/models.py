from typing import Optional
from sqlmodel import SQLModel, Field


class Floor(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    level: int = Field(default=1)


class Room(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    width_m: float
    height_m: float
    floor_id: Optional[int] = Field(default=None, foreign_key="floor.id")


class DevicePlacement(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    room_id: int = Field(index=True)
    entity_id: str = Field(index=True)
    label: str
    x_m: float
    y_m: float
    size_m: float = Field(default=0.1)
    device_type: Optional[str] = Field(default=None)
    # When None, type is derived from entity_id domain. When set, overrides the derived type.


class Fixture(SQLModel, table=True):
    __tablename__ = "fixture"
    id: Optional[int] = Field(default=None, primary_key=True)
    room_id: int = Field(index=True)
    kind: str = Field(default="wall", index=True)
    rotation_degrees: float = Field(default=0.0)
    length_m: float
    thickness_m: float
    x_m: float
    y_m: float
