from typing import Any, Dict, List, Optional
import logging
from sqlmodel import select

from .database import get_session
from .models import Room, DevicePlacement
from .ha_client import discover_devices

logger = logging.getLogger(__name__)


def tool_discover_devices() -> List[Dict[str, Any]]:
    devices = discover_devices()
    logger.info("discover_devices returned %d devices", len(devices))
    return devices


def tool_create_room(name: str, width_m: float, height_m: float) -> Dict[str, Any]:
    logger.info("create_room requested: name=%s width=%.2f height=%.2f", name, width_m, height_m)
    with get_session() as session:
        existing = session.exec(select(Room).where(Room.name == name)).first()
        if existing:
            logger.warning("create_room rejected duplicate name: %s", name)
            return {"error": f"Room '{name}' already exists."}

        room = Room(name=name, width_m=width_m, height_m=height_m)
        session.add(room)
        session.commit()
        session.refresh(room)
        logger.info("create_room created: id=%s name=%s", room.id, room.name)
        return {"id": room.id, "name": room.name, "width_m": room.width_m, "height_m": room.height_m}


def tool_list_rooms() -> List[Dict[str, Any]]:
    with get_session() as session:
        rooms = session.exec(select(Room)).all()
        logger.info("list_rooms returned %d rooms", len(rooms))
        return [{"id": r.id, "name": r.name, "width_m": r.width_m, "height_m": r.height_m} for r in rooms]


def _get_room_by_name(name: str) -> Optional[Room]:
    with get_session() as session:
        return session.exec(select(Room).where(Room.name == name)).first()


def _get_room_by_id(room_id: int) -> Optional[Room]:
    with get_session() as session:
        return session.get(Room, room_id)


def _build_room_map(room: Room) -> Dict[str, Any]:
    with get_session() as session:
        placements = session.exec(select(DevicePlacement).where(DevicePlacement.room_id == room.id)).all()
        return {
            "room": {"id": room.id, "name": room.name, "width_m": room.width_m, "height_m": room.height_m},
            "placements": [
                {
                    "id": p.id,
                    "entity_id": p.entity_id,
                    "label": p.label,
                    "x_m": p.x_m,
                    "y_m": p.y_m,
                }
                for p in placements
            ],
        }


def tool_place_device(room_name: str, entity_id: str, label: str, x_m: float, y_m: float) -> Dict[str, Any]:
    logger.info(
        "place_device requested: room=%s entity=%s x=%.2f y=%.2f",
        room_name,
        entity_id,
        x_m,
        y_m,
    )
    room = _get_room_by_name(room_name)
    if not room:
        logger.warning("place_device failed; room not found: %s", room_name)
        return {"error": f"Room '{room_name}' not found."}

    if x_m < 0 or y_m < 0 or x_m > room.width_m or y_m > room.height_m:
        logger.warning("place_device failed; out of bounds for room: %s", room_name)
        return {"error": "Placement is out of room bounds."}

    with get_session() as session:
        placement = DevicePlacement(
            room_id=room.id,
            entity_id=entity_id,
            label=label,
            x_m=x_m,
            y_m=y_m,
        )
        session.add(placement)
        session.commit()
        session.refresh(placement)
        logger.info("place_device created placement id=%s", placement.id)
        return {
            "id": placement.id,
            "room_id": placement.room_id,
            "entity_id": placement.entity_id,
            "label": placement.label,
            "x_m": placement.x_m,
            "y_m": placement.y_m,
        }


def tool_move_device(placement_id: int, x_m: float, y_m: float) -> Dict[str, Any]:
    logger.info("move_device requested: placement_id=%s x=%.2f y=%.2f", placement_id, x_m, y_m)
    with get_session() as session:
        placement = session.get(DevicePlacement, placement_id)
        if not placement:
            logger.warning("move_device failed; placement not found: %s", placement_id)
            return {"error": f"Placement {placement_id} not found."}

        room = session.get(Room, placement.room_id)
        if not room:
            logger.warning("move_device failed; room missing for placement: %s", placement_id)
            return {"error": "Room for placement not found."}

        if x_m < 0 or y_m < 0 or x_m > room.width_m or y_m > room.height_m:
            logger.warning("move_device failed; out of bounds for placement: %s", placement_id)
            return {"error": "Target position is out of room bounds."}

        placement.x_m = x_m
        placement.y_m = y_m
        session.add(placement)
        session.commit()
        session.refresh(placement)
        logger.info("move_device updated placement id=%s", placement.id)
        return {
            "id": placement.id,
            "room_id": placement.room_id,
            "entity_id": placement.entity_id,
            "label": placement.label,
            "x_m": placement.x_m,
            "y_m": placement.y_m,
        }


def tool_render_room_map(room_name: str) -> Dict[str, Any]:
    logger.info("render_room_map requested: room=%s", room_name)
    room = _get_room_by_name(room_name)
    if not room:
        logger.warning("render_room_map failed; room not found: %s", room_name)
        return {"error": f"Room '{room_name}' not found."}

    room_map = _build_room_map(room)
    logger.info("render_room_map returned %d placements for room_id=%s", len(room_map["placements"]), room.id)
    return room_map


def tool_render_room_map_by_id(room_id: int) -> Dict[str, Any]:
    logger.info("render_room_map_by_id requested: room_id=%s", room_id)
    room = _get_room_by_id(room_id)
    if not room:
        logger.warning("render_room_map_by_id failed; room not found: %s", room_id)
        return {"error": f"Room id {room_id} not found."}

    room_map = _build_room_map(room)
    logger.info("render_room_map_by_id returned %d placements for room_id=%s", len(room_map["placements"]), room.id)
    return room_map
