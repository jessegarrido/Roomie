from typing import Any, Dict, List, Optional
import logging
from sqlmodel import select

from .database import get_session
from .models import ArchitecturalElement, Floor, Room, DevicePlacement
from .ha_client import discover_devices, get_device_states

logger = logging.getLogger(__name__)

# Lazy-loaded sentence-transformers model for embedding generation
_embedding_model = None

# In-memory cache for discovered devices and their embeddings (refreshed on demand)
_device_cache: Optional[Dict[str, Any]] = None


def _get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        from sentence_transformers import SentenceTransformer
        # "all-MiniLM-L6-v2" is a free, fast, and good-quality model from Hugging Face
        _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _embedding_model

VALID_ARCHITECTURAL_KINDS = {"wall", "door", "window", "stairs", "void", "desk", "sofa", "box"}
DEFAULT_ELEMENT_LENGTH_M = 3 * 0.3048
DEFAULT_ELEMENT_THICKNESS_M = 1 * 0.3048


def tool_discover_devices() -> List[Dict[str, Any]]:
    devices = discover_devices()
    logger.info("discover_devices returned %d devices", len(devices))
    return devices


def tool_create_floor(name: str, level: int = 1) -> Dict[str, Any]:
    logger.info("create_floor requested: name=%s level=%d", name, level)
    with get_session() as session:
        existing = session.exec(select(Floor).where(Floor.name == name)).first()
        if existing:
            logger.warning("create_floor rejected duplicate name: %s", name)
            return {"error": f"Floor '{name}' already exists."}

        floor = Floor(name=name, level=level)
        session.add(floor)
        session.commit()
        session.refresh(floor)
        logger.info("create_floor created: id=%s name=%s level=%d", floor.id, floor.name, floor.level)
        return {"id": floor.id, "name": floor.name, "level": floor.level}


def tool_list_floors() -> List[Dict[str, Any]]:
    with get_session() as session:
        floors = session.exec(select(Floor).order_by(Floor.level)).all()
        logger.info("list_floors returned %d floors", len(floors))
        return [{"id": f.id, "name": f.name, "level": f.level} for f in floors]


def tool_delete_floor(floor_id: int) -> Dict[str, Any]:
    logger.info("delete_floor requested: floor_id=%s", floor_id)
    with get_session() as session:
        floor = session.get(Floor, floor_id)
        if not floor:
            logger.warning("delete_floor failed; floor not found: %s", floor_id)
            return {"error": f"Floor id {floor_id} not found."}

        # Unassign rooms from this floor before deleting
        rooms_on_floor = session.exec(select(Room).where(Room.floor_id == floor_id)).all()
        for r in rooms_on_floor:
            r.floor_id = None
            session.add(r)

        session.delete(floor)
        session.commit()
        logger.info("delete_floor removed floor id=%s and unassigned %d rooms", floor_id, len(rooms_on_floor))
        return {"ok": True, "id": floor_id}


def tool_rename_floor(floor_id: int, name: str) -> Dict[str, Any]:
    logger.info("rename_floor requested: floor_id=%s name=%s", floor_id, name)
    with get_session() as session:
        floor = session.get(Floor, floor_id)
        if not floor:
            logger.warning("rename_floor failed; floor not found: %s", floor_id)
            return {"error": f"Floor id {floor_id} not found."}
        existing = session.exec(select(Floor).where(Floor.name == name, Floor.id != floor_id)).first()
        if existing:
            logger.warning("rename_floor rejected duplicate name: %s", name)
            return {"error": f"Floor '{name}' already exists."}
        floor.name = name
        session.add(floor)
        session.commit()
        session.refresh(floor)
        logger.info("rename_floor updated: id=%s name=%s", floor.id, floor.name)
        return {"id": floor.id, "name": floor.name, "level": floor.level}


def tool_assign_room_to_floor(room_id: int, floor_id: Optional[int] = None) -> Dict[str, Any]:
    logger.info("assign_room_to_floor requested: room_id=%s floor_id=%s", room_id, floor_id)
    with get_session() as session:
        room = session.get(Room, room_id)
        if not room:
            logger.warning("assign_room_to_floor failed; room not found: %s", room_id)
            return {"error": f"Room id {room_id} not found."}

        if floor_id is not None:
            floor = session.get(Floor, floor_id)
            if not floor:
                logger.warning("assign_room_to_floor failed; floor not found: %s", floor_id)
                return {"error": f"Floor id {floor_id} not found."}

        room.floor_id = floor_id
        session.add(room)
        session.commit()
        session.refresh(room)
        logger.info("assign_room_to_floor updated room id=%s to floor_id=%s", room.id, room.floor_id)
        return {"id": room.id, "name": room.name, "width_m": room.width_m, "height_m": room.height_m, "floor_id": room.floor_id}


def tool_create_room(name: str, width_m: float, height_m: float, floor_id: Optional[int] = None) -> Dict[str, Any]:
    logger.info("create_room requested: name=%s width=%.2f height=%.2f", name, width_m, height_m)
    with get_session() as session:
        existing = session.exec(select(Room).where(Room.name == name)).first()
        if existing:
            logger.warning("create_room rejected duplicate name: %s", name)
            return {"error": f"Room '{name}' already exists."}

        room = Room(name=name, width_m=width_m, height_m=height_m, floor_id=floor_id)
        session.add(room)
        session.commit()
        session.refresh(room)
        logger.info("create_room created: id=%s name=%s", room.id, room.name)
        return {"id": room.id, "name": room.name, "width_m": room.width_m, "height_m": room.height_m, "floor_id": room.floor_id}


def tool_list_rooms() -> List[Dict[str, Any]]:
    with get_session() as session:
        rooms = session.exec(select(Room)).all()
        logger.info("list_rooms returned %d rooms", len(rooms))
        return [{"id": r.id, "name": r.name, "width_m": r.width_m, "height_m": r.height_m, "floor_id": r.floor_id} for r in rooms]


def _resize_room_and_reposition(session, room: Room, width_m: float, height_m: float) -> Dict[str, Any]:
    if width_m <= 0 or height_m <= 0:
        return {"error": "Room dimensions must be positive."}

    room.width_m = width_m
    room.height_m = height_m
    default_x_m = width_m / 2
    default_y_m = height_m / 2

    placements = session.exec(select(DevicePlacement).where(DevicePlacement.room_id == room.id)).all()
    elements = session.exec(select(ArchitecturalElement).where(ArchitecturalElement.room_id == room.id)).all()

    repositioned_placements = 0
    repositioned_elements = 0

    for placement in placements:
        if placement.x_m < 0 or placement.y_m < 0 or placement.x_m > width_m or placement.y_m > height_m:
            placement.x_m = default_x_m
            placement.y_m = default_y_m
            session.add(placement)
            repositioned_placements += 1

    for element in elements:
        if element.x_m < 0 or element.y_m < 0 or element.x_m > width_m or element.y_m > height_m:
            element.x_m = default_x_m
            element.y_m = default_y_m
            session.add(element)
            repositioned_elements += 1

    session.add(room)
    session.commit()
    session.refresh(room)
    return {
        "id": room.id,
        "name": room.name,
        "width_m": room.width_m,
        "height_m": room.height_m,
        "repositioned_placements": repositioned_placements,
        "repositioned_architectural_elements": repositioned_elements,
    }


def tool_resize_room(room_name: str, width_m: float, height_m: float) -> Dict[str, Any]:
    logger.info("resize_room requested: room=%s width=%.2f height=%.2f", room_name, width_m, height_m)
    with get_session() as session:
        room = session.exec(select(Room).where(Room.name == room_name)).first()
        if not room:
            logger.warning("resize_room failed; room not found: %s", room_name)
            return {"error": f"Room '{room_name}' not found."}
        return _resize_room_and_reposition(session, room, width_m, height_m)


def tool_resize_room_by_id(room_id: int, width_m: float, height_m: float) -> Dict[str, Any]:
    logger.info("resize_room_by_id requested: room_id=%s width=%.2f height=%.2f", room_id, width_m, height_m)
    with get_session() as session:
        room = session.get(Room, room_id)
        if not room:
            logger.warning("resize_room_by_id failed; room not found: %s", room_id)
            return {"error": f"Room id {room_id} not found."}
        return _resize_room_and_reposition(session, room, width_m, height_m)


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

        # Enrich placements with current device state from Home Assistant
        device_states = get_device_states()

        return {
            "room": {"id": room.id, "name": room.name, "width_m": room.width_m, "height_m": room.height_m, "floor_id": room.floor_id},
            "placements": [
                {
                    "id": p.id,
                    "entity_id": p.entity_id,
                    "label": p.label,
                    "x_m": p.x_m,
                    "y_m": p.y_m,
                    "state": device_states.get(p.entity_id),
                }
                for p in placements
            ],
            "architectural_elements": [
                {
                    "id": e.id,
                    "kind": e.kind,
                    "rotation_degrees": e.rotation_degrees,
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
    rotation_degrees: float = 0.0,
) -> Dict[str, Any]:
    logger.info(
        "insert_architectural_element requested: room=%s kind=%s x=%.2f y=%.2f rotation=%.1f",
        room_name,
        kind,
        x_m,
        y_m,
        rotation_degrees,
    )
    room = _get_room_by_name(room_name)
    if not room:
        return {"error": f"Room '{room_name}' not found."}

    if kind not in VALID_ARCHITECTURAL_KINDS:
        return {"error": f"Unsupported element kind '{kind}'."}

    chosen_length_m = length_m if length_m is not None else DEFAULT_ELEMENT_LENGTH_M
    chosen_thickness_m = thickness_m if thickness_m is not None else DEFAULT_ELEMENT_THICKNESS_M
    if chosen_length_m <= 0:
        return {"error": "Element length must be positive."}
    if chosen_thickness_m <= 0:
        return {"error": "Element thickness must be positive."}

    with get_session() as session:
        element = ArchitecturalElement(
            room_id=room.id,
            kind=kind,
            rotation_degrees=rotation_degrees,
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
            "rotation_degrees": element.rotation_degrees,
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
    rotation_degrees: float = 0.0,
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
        rotation_degrees=rotation_degrees,
    )


def tool_update_architectural_element(
    element_id: int,
    kind: Optional[str] = None,
    rotation_degrees: Optional[float] = None,
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
        if rotation_degrees is not None:
            element.rotation_degrees = rotation_degrees

        if x_m is not None:
            element.x_m = x_m
        if y_m is not None:
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
            "rotation_degrees": element.rotation_degrees,
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


def tool_delete_room(room_id: int) -> Dict[str, Any]:
    logger.info("delete_room requested: room_id=%s", room_id)
    with get_session() as session:
        room = session.get(Room, room_id)
        if not room:
            logger.warning("delete_room failed; room not found: %s", room_id)
            return {"error": f"Room id {room_id} not found."}

        placements = session.exec(select(DevicePlacement).where(DevicePlacement.room_id == room_id)).all()
        for p in placements:
            session.delete(p)

        elements = session.exec(select(ArchitecturalElement).where(ArchitecturalElement.room_id == room_id)).all()
        for e in elements:
            session.delete(e)

        session.delete(room)
        session.commit()
        logger.info("delete_room removed room id=%s along with %d placements and %d elements", room_id, len(placements), len(elements))
        return {"ok": True, "id": room_id}


def tool_rename_room(room_id: int, name: str) -> Dict[str, Any]:
    logger.info("rename_room requested: room_id=%s name=%s", room_id, name)
    with get_session() as session:
        room = session.get(Room, room_id)
        if not room:
            logger.warning("rename_room failed; room not found: %s", room_id)
            return {"error": f"Room id {room_id} not found."}
        existing = session.exec(select(Room).where(Room.name == name, Room.id != room_id)).first()
        if existing:
            logger.warning("rename_room rejected duplicate name: %s", name)
            return {"error": f"Room '{name}' already exists."}
        room.name = name
        session.add(room)
        session.commit()
        session.refresh(room)
        logger.info("rename_room updated: id=%s name=%s", room.id, room.name)
        return {"id": room.id, "name": room.name, "width_m": room.width_m, "height_m": room.height_m, "floor_id": room.floor_id}


def tool_rename_room_by_name(room_name: str, new_name: str) -> Dict[str, Any]:
    logger.info("rename_room_by_name requested: room_name=%s new_name=%s", room_name, new_name)
    room = _get_room_by_name(room_name)
    if not room:
        logger.warning("rename_room_by_name failed; room not found: %s", room_name)
        return {"error": f"Room '{room_name}' not found."}
    with get_session() as session:
        existing = session.exec(select(Room).where(Room.name == new_name, Room.id != room.id)).first()
        if existing:
            logger.warning("rename_room_by_name rejected duplicate name: %s", new_name)
            return {"error": f"Room '{new_name}' already exists."}
        room = session.get(Room, room.id)
        room.name = new_name
        session.add(room)
        session.commit()
        session.refresh(room)
        logger.info("rename_room_by_name updated: id=%s name=%s", room.id, room.name)
        return {"id": room.id, "name": room.name, "width_m": room.width_m, "height_m": room.height_m, "floor_id": room.floor_id}


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


def tool_generate_embeddings(texts: List[str]) -> Dict[str, Any]:
    """
    Generate vector embeddings for a list of text strings using a free Hugging Face model.
    Returns a list of embedding vectors (384-dimensional for all-MiniLM-L6-v2).
    """
    logger.info("generate_embeddings requested for %d texts", len(texts))
    if not texts:
        return {"error": "No texts provided."}
    try:
        model = _get_embedding_model()
        embeddings = model.encode(texts, normalize_embeddings=True)
        # Convert numpy array to list of lists for JSON serialization
        embedding_lists = embeddings.tolist()
        return {
            "count": len(texts),
            "dimension": len(embedding_lists[0]) if embedding_lists else 0,
            "embeddings": embedding_lists,
        }
    except Exception as e:
        logger.error("generate_embeddings failed: %s", e)
        return {"error": str(e)}


def _get_device_cache() -> Dict[str, Any]:
    """Return cached device list with pre-computed embeddings, rebuilding if needed."""
    global _device_cache
    if _device_cache is None or _device_cache.get("needs_refresh", False):
        devices = discover_devices()
        texts = [f"{d['name']} {d['entity_id']} {d['domain']} {d.get('area', '') or ''}" for d in devices]
        model = _get_embedding_model()
        embeddings = model.encode(texts, normalize_embeddings=True)
        _device_cache = {
            "devices": devices,
            "embeddings": embeddings.tolist(),
            "texts": texts,
            "needs_refresh": False,
        }
        logger.info("Device cache rebuilt: %d devices", len(devices))
    return _device_cache


def tool_search_devices(query: str, top_k: int = 20) -> Dict[str, Any]:
    """
    Search discovered devices by semantic similarity using embeddings.
    Returns the top_k most relevant matches for the query.
    """
    logger.info("search_devices requested: query=%s top_k=%d", query, top_k)
    if not query.strip():
        return {"error": "Query cannot be empty."}
    try:
        cache = _get_device_cache()
        model = _get_embedding_model()
        query_embedding = model.encode([query], normalize_embeddings=True)[0].tolist()
        # Cosine similarity = dot product since embeddings are normalized
        similarities = [
            sum(q * e for q, e in zip(query_embedding, emb))
            for emb in cache["embeddings"]
        ]
        # Sort by similarity descending
        ranked = sorted(zip(similarities, cache["devices"]), key=lambda x: x[0], reverse=True)
        results = [
            {**device, "relevance_score": round(score, 4)}
            for score, device in ranked[:top_k]
        ]
        return {"query": query, "count": len(results), "results": results}
    except Exception as e:
        logger.error("search_devices failed: %s", e)
        return {"error": str(e)}


def tool_add_devices_to_room(room_name: str, description: str, max_devices: int = 10) -> Dict[str, Any]:
    """
    Search for devices matching a semantic description and place them all in a room.
    Uses both Home Assistant device attributes (name, domain, area) and pre-computed
    embeddings for relevance ranking. Devices are placed along the perimeter of the room.
    Returns a summary of which devices were placed.
    """
    logger.info("add_devices_to_room requested: room=%s description=%s max=%d", room_name, description, max_devices)

    room = _get_room_by_name(room_name)
    if not room:
        return {"error": f"Room '{room_name}' not found."}

    search_results = tool_search_devices(description, top_k=max_devices)
    if "error" in search_results:
        return search_results

    placed = []
    errors = []
    # Place devices along perimeter, cycling through sides
    sides = [
        (0, 0, room.width_m - 0.5, 0),          # bottom wall
        (room.width_m - 0.5, 0, room.width_m - 0.5, room.height_m - 0.5),  # right wall
        (0, room.height_m - 0.5, room.width_m - 0.5, room.height_m - 0.5),  # top wall
        (0, 0, 0, room.height_m - 0.5),         # left wall
    ]
    slot_width = 0.6  # meters between device slots

    for idx, device in enumerate(search_results.get("results", [])):
        side_idx = idx % len(sides)
        side = sides[side_idx]
        # Simple linear spacing along each side
        offset = (idx // len(sides)) * slot_width
        if side_idx == 0:      # bottom wall: left to right
            x, y = side[0] + offset, side[1] + 0.3
        elif side_idx == 1:    # right wall: bottom to top
            x, y = side[0] - 0.3, side[1] + offset
        elif side_idx == 2:    # top wall: right to left
            x, y = side[2] - offset, side[3] - 0.3
        else:                  # left wall: top to bottom
            x, y = side[0] + 0.3, side[3] - offset

        # Clamp to room bounds
        x = max(0.2, min(room.width_m - 0.2, x))
        y = max(0.2, min(room.height_m - 0.2, y))

        result = tool_place_device(room_name, device["entity_id"], device["name"], x, y)
        if "error" in result:
            errors.append({"entity_id": device["entity_id"], "error": result["error"]})
        else:
            placed.append({"entity_id": device["entity_id"], "label": device["name"], "x_m": x, "y_m": y, "relevance_score": device.get("relevance_score")})

    return {
        "room": room_name,
        "description": description,
        "placed_count": len(placed),
        "devices": placed,
        "errors": errors,
    }
