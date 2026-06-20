from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.tools import tool_create_room, tool_place_device


def test_rooms_endpoint_lists_created_room() -> None:
    room_name = f"API Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 4.0, 3.0)
    assert "error" not in created

    with TestClient(app) as client:
        response = client.get("/rooms")

    assert response.status_code == 200
    rooms = response.json()
    assert any(room["id"] == created["id"] and room["name"] == room_name for room in rooms)


def test_room_map_endpoint_returns_room_and_placements() -> None:
    room_name = f"API Map Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 5.0, 4.0)
    assert "error" not in created

    placed = tool_place_device(room_name, "light.api_test", "API Test Light", 1.0, 1.5)
    assert "error" not in placed

    with TestClient(app) as client:
        response = client.get(f"/rooms/{created['id']}/map")

    assert response.status_code == 200
    payload = response.json()
    assert payload["room"]["id"] == created["id"]
    assert payload["room"]["name"] == room_name
    assert any(p["id"] == placed["id"] and p["label"] == "API Test Light" for p in payload["placements"])


def test_room_map_endpoint_returns_404_for_missing_room() -> None:
    with TestClient(app) as client:
        response = client.get("/rooms/999999/map")

    assert response.status_code == 404
    detail = response.json().get("detail", "")
    assert "not found" in detail.lower()


def test_move_placement_endpoint_updates_coordinates() -> None:
    room_name = f"API Move Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 5.0, 4.0)
    assert "error" not in created

    placed = tool_place_device(room_name, "switch.move_test", "Move Test Switch", 1.0, 1.5)
    assert "error" not in placed

    with TestClient(app) as client:
        move_response = client.patch(
            f"/placements/{placed['id']}",
            json={"x_m": 2.25, "y_m": 3.0},
        )
        map_response = client.get(f"/rooms/{created['id']}/map")

    assert move_response.status_code == 200
    moved = move_response.json()
    assert moved["id"] == placed["id"]
    assert moved["x_m"] == 2.25
    assert moved["y_m"] == 3.0

    assert map_response.status_code == 200
    payload = map_response.json()
    moved_from_map = next(p for p in payload["placements"] if p["id"] == placed["id"])
    assert moved_from_map["x_m"] == 2.25
    assert moved_from_map["y_m"] == 3.0


def test_move_placement_endpoint_rejects_out_of_bounds() -> None:
    room_name = f"API Move OOB Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 4.0, 3.0)
    assert "error" not in created

    placed = tool_place_device(room_name, "switch.move_oob", "Move OOB Switch", 1.0, 1.0)
    assert "error" not in placed

    with TestClient(app) as client:
        response = client.patch(
            f"/placements/{placed['id']}",
            json={"x_m": 99.0, "y_m": 1.0},
        )

    assert response.status_code == 400
    detail = response.json().get("detail", "")
    assert "out of room bounds" in detail.lower() or "out of room" in detail.lower()
