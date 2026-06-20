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
