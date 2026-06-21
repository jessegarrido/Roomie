from app.database import init_db
from app.tools import (
    tool_create_room,
    tool_insert_architectural_element,
    tool_place_device,
    tool_resize_room,
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

    updated = tool_update_architectural_element(inserted["id"], kind="door", rotation_degrees=90.0)
    assert "error" not in updated
    assert updated["kind"] == "door"
    assert updated["rotation_degrees"] == 90.0

    room_map = tool_render_room_map(room_name)
    assert "error" not in room_map
    assert any(e["id"] == inserted["id"] for e in room_map.get("architectural_elements", []))


def test_resize_room_repositions_only_out_of_bounds_items() -> None:
    init_db()
    room_name = f"Resize Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    in_bounds = tool_place_device(room_name, "sensor.keep", "Keep Sensor", 1.0, 1.0)
    assert "error" not in in_bounds
    to_move = tool_place_device(room_name, "sensor.move", "Move Sensor", 5.5, 3.8)
    assert "error" not in to_move

    arch_keep = tool_insert_architectural_element(room_name, "wall", 2.0, 2.0)
    assert "error" not in arch_keep
    arch_move = tool_insert_architectural_element(room_name, "door", 5.8, 3.9)
    assert "error" not in arch_move

    resized = tool_resize_room(room_name, 3.0, 2.0)
    assert "error" not in resized
    assert resized["repositioned_placements"] == 1
    assert resized["repositioned_architectural_elements"] == 1

    room_map = tool_render_room_map(room_name)
    assert "error" not in room_map

    kept_placement = next(p for p in room_map["placements"] if p["id"] == in_bounds["id"])
    moved_placement = next(p for p in room_map["placements"] if p["id"] == to_move["id"])
    kept_arch = next(e for e in room_map["architectural_elements"] if e["id"] == arch_keep["id"])
    moved_arch = next(e for e in room_map["architectural_elements"] if e["id"] == arch_move["id"])

    assert kept_placement["x_m"] == 1.0
    assert kept_placement["y_m"] == 1.0
    assert moved_placement["x_m"] == 1.5
    assert moved_placement["y_m"] == 1.0
    assert kept_arch["x_m"] == 2.0
    assert kept_arch["y_m"] == 2.0
    assert moved_arch["x_m"] == 1.5
    assert moved_arch["y_m"] == 1.0


def test_resize_room_rejects_non_positive_dimensions() -> None:
    init_db()
    room_name = f"Resize Invalid {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 4.0, 3.0)
    assert "error" not in created

    result = tool_resize_room(room_name, 0.0, 2.0)
    assert "error" in result
    assert "positive" in result["error"].lower()
