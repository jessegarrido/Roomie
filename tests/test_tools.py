from app.database import init_db
from app.tools import tool_create_room, tool_place_device, tool_render_room_map
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
