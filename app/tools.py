from typing import Any, Dict, List, Optional
import logging
from sqlmodel import select

from .database import get_session
from .models import ArchitecturalElement, Room, DevicePlacement
from .ha_client import discover_devices

logger = logging.getLogger(__name__)

VALID_ARCHITECTURAL_KINDS = {"wall", "door", "window", "stairs"}
VALID_ORIENTATIONS = {"horizontal", "vertical"}
DEFAULT_ELEMENT_LENGTH_M = 3 * 0.3048
DEFAULT_ELEMENT_THICKNESS_M = 1 * 0.3048


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
        elements = session.exec(select(ArchitecturalElement).where(ArchitecturalElement.room_id == room.id)).all()
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
            "architectural_elements": [
                {
                    "id": e.id,
                    "kind": e.kind,
                    "orientation": e.orientation,
                    "length_m": e.length_m,
                    "thickness_m": e.thickness_m,
                    "x_m": e.x_m,
                    "y_m": e.y_m,
                }
                for e in elements
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


def tool_place_device_by_room_id(room_id: int, entity_id: str, label: str, x_m: float, y_m: float) -> Dict[str, Any]:
    logger.info(
        "place_device_by_room_id requested: room_id=%s entity=%s x=%.2f y=%.2f",
        room_id,
        entity_id,
        x_m,
        y_m,
    )
    room = _get_room_by_id(room_id)
    if not room:
        logger.warning("place_device_by_room_id failed; room not found: %s", room_id)
        return {"error": f"Room id {room_id} not found."}

    return tool_place_device(room.name, entity_id, label, x_m, y_m)


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


def tool_delete_device(placement_id: int) -> Dict[str, Any]:
    logger.info("delete_device requested: placement_id=%s", placement_id)
    with get_session() as session:
        placement = session.get(DevicePlacement, placement_id)
        if not placement:
            logger.warning("delete_device failed; placement not found: %s", placement_id)
            return {"error": f"Placement {placement_id} not found."}

        session.delete(placement)
        session.commit()
        logger.info("delete_device removed placement id=%s", placement_id)
        return {"ok": True, "id": placement_id}


def tool_insert_architectural_element(
    room_name: str,
    kind: str,
    x_m: float,
    y_m: float,
    length_m: Optional[float] = None,
    thickness_m: Optional[float] = None,
    orientation: str = "vertical",
) -> Dict[str, Any]:
    logger.info(
        "insert_architectural_element requested: room=%s kind=%s x=%.2f y=%.2f orientation=%s",
        room_name,
        kind,
        x_m,
        y_m,
        orientation,
    )
    room = _get_room_by_name(room_name)
    if not room:
        return {"error": f"Room '{room_name}' not found."}

    if kind not in VALID_ARCHITECTURAL_KINDS:
        return {"error": f"Unsupported element kind '{kind}'."}
    if orientation not in VALID_ORIENTATIONS:
        return {"error": f"Unsupported orientation '{orientation}'."}

    chosen_length_m = length_m if length_m is not None else DEFAULT_ELEMENT_LENGTH_M
    chosen_thickness_m = thickness_m if thickness_m is not None else DEFAULT_ELEMENT_THICKNESS_M
    if chosen_length_m <= 0:
        return {"error": "Element length must be positive."}
    if chosen_thickness_m <= 0:
        return {"error": "Element thickness must be positive."}
    if x_m < 0 or y_m < 0 or x_m > room.width_m or y_m > room.height_m:
        return {"error": "Element position is out of room bounds."}

    with get_session() as session:
        element = ArchitecturalElement(
            room_id=room.id,
            kind=kind,
            orientation=orientation,
            length_m=chosen_length_m,
            thickness_m=chosen_thickness_m,
            x_m=x_m,
            y_m=y_m,
        )
        session.add(element)
        session.commit()
        session.refresh(element)
        return {
            "id": element.id,
            "room_id": element.room_id,
            "kind": element.kind,
            "orientation": element.orientation,
            "length_m": element.length_m,
            "thickness_m": element.thickness_m,
            "x_m": element.x_m,
            "y_m": element.y_m,
        }


def tool_insert_architectural_element_by_room_id(
    room_id: int,
    kind: str,
    x_m: float,
    y_m: float,
    length_m: Optional[float] = None,
    thickness_m: Optional[float] = None,
    orientation: str = "vertical",
) -> Dict[str, Any]:
    room = _get_room_by_id(room_id)
    if not room:
        return {"error": f"Room id {room_id} not found."}
    return tool_insert_architectural_element(
        room_name=room.name,
        kind=kind,
        x_m=x_m,
        y_m=y_m,
        length_m=length_m,
        thickness_m=thickness_m,
        orientation=orientation,
    )


def tool_update_architectural_element(
    element_id: int,
    kind: Optional[str] = None,
    orientation: Optional[str] = None,
    x_m: Optional[float] = None,
    y_m: Optional[float] = None,
    length_m: Optional[float] = None,
    thickness_m: Optional[float] = None,
) -> Dict[str, Any]:
    with get_session() as session:
        element = session.get(ArchitecturalElement, element_id)
        if not element:
            return {"error": f"Architectural element {element_id} not found."}

        room = session.get(Room, element.room_id)
        if not room:
            return {"error": "Room for architectural element not found."}

        if kind is not None:
            if kind not in VALID_ARCHITECTURAL_KINDS:
                return {"error": f"Unsupported element kind '{kind}'."}
            element.kind = kind
        if orientation is not None:
            if orientation not in VALID_ORIENTATIONS:
                return {"error": f"Unsupported orientation '{orientation}'."}
            element.orientation = orientation

        if x_m is not None:
            if x_m < 0 or x_m > room.width_m:
                return {"error": "Element position is out of room bounds."}
            element.x_m = x_m
        if y_m is not None:
            if y_m < 0 or y_m > room.height_m:
                return {"error": "Element position is out of room bounds."}
            element.y_m = y_m
        if length_m is not None:
            if length_m <= 0:
                return {"error": "Element length must be positive."}
            element.length_m = length_m
        if thickness_m is not None:
            if thickness_m <= 0:
                return {"error": "Element thickness must be positive."}
            element.thickness_m = thickness_m

        session.add(element)
        session.commit()
        session.refresh(element)
        return {
            "id": element.id,
            "room_id": element.room_id,
            "kind": element.kind,
            "orientation": element.orientation,
            "length_m": element.length_m,
            "thickness_m": element.thickness_m,
            "x_m": element.x_m,
            "y_m": element.y_m,
        }


def tool_delete_architectural_element(element_id: int) -> Dict[str, Any]:
    logger.info("delete_architectural_element requested: element_id=%s", element_id)
    with get_session() as session:
        element = session.get(ArchitecturalElement, element_id)
        if not element:
            return {"error": f"Architectural element {element_id} not found."}

        session.delete(element)
        session.commit()
        return {"ok": True, "id": element_id}


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
