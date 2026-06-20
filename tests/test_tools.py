from app.database import init_db
from app.tools import (
    tool_create_room,
    tool_insert_architectural_element,
    tool_place_device,
    tool_render_room_map,
    tool_update_architectural_element,
)
from uuid import uuid4


def test_create_place_render_cycle() -> None:
    init_db()
    room_name = f"Test Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 3.0, 3.0)
    assert "error" not in created

    placed = tool_place_device(room_name, "switch.test", "Test Switch", 1.0, 1.0)
    assert "error" not in placed

    room_map = tool_render_room_map(room_name)
    assert "error" not in room_map
    assert room_map["room"]["name"] == room_name
    assert len(room_map["placements"]) >= 1


def test_insert_architectural_element_default_length_and_update() -> None:
    init_db()
    room_name = f"Arch Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 4.0, 3.0)
    assert "error" not in created

    inserted = tool_insert_architectural_element(room_name, "wall", 1.0, 1.0)
    assert "error" not in inserted
    assert abs(inserted["length_m"] - 0.9144) < 1e-6
    assert abs(inserted["thickness_m"] - 0.3048) < 1e-6

    updated = tool_update_architectural_element(inserted["id"], kind="door", orientation="horizontal")
    assert "error" not in updated
    assert updated["kind"] == "door"
    assert updated["orientation"] == "horizontal"

    room_map = tool_render_room_map(room_name)
    assert "error" not in room_map
    assert any(e["id"] == inserted["id"] for e in room_map.get("architectural_elements", []))
