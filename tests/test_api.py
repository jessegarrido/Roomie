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


def test_create_placement_endpoint_adds_device_to_room_map() -> None:
    room_name = f"API Create Placement Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    with TestClient(app) as client:
        create_response = client.post(
            f"/rooms/{created['id']}/placements",
            json={
                "entity_id": "light.drag_test",
                "label": "Drag Test Light",
                "x_m": 2.5,
                "y_m": 1.5,
            },
        )
        map_response = client.get(f"/rooms/{created['id']}/map")

    assert create_response.status_code == 200
    created_placement = create_response.json()
    assert created_placement["entity_id"] == "light.drag_test"
    assert created_placement["label"] == "Drag Test Light"
    assert created_placement["x_m"] == 2.5
    assert created_placement["y_m"] == 1.5

    assert map_response.status_code == 200
    payload = map_response.json()
    assert any(p["id"] == created_placement["id"] for p in payload["placements"])


def test_create_placement_endpoint_rejects_out_of_bounds() -> None:
    room_name = f"API Create Placement OOB {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 4.0, 3.0)
    assert "error" not in created

    with TestClient(app) as client:
        response = client.post(
            f"/rooms/{created['id']}/placements",
            json={
                "entity_id": "light.drag_oob",
                "label": "Drag OOB Light",
                "x_m": 99.0,
                "y_m": 1.0,
            },
        )

    assert response.status_code == 400
    detail = response.json().get("detail", "")
    assert "out of room bounds" in detail.lower() or "out of room" in detail.lower()


def test_delete_placement_endpoint_removes_placement_from_map() -> None:
    room_name = f"API Delete Placement Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 5.0, 4.0)
    assert "error" not in created

    placed = tool_place_device(room_name, "light.delete_test", "Delete Test Light", 1.2, 1.8)
    assert "error" not in placed

    with TestClient(app) as client:
        delete_response = client.delete(f"/placements/{placed['id']}")
        map_response = client.get(f"/rooms/{created['id']}/map")

    assert delete_response.status_code == 200
    deleted_payload = delete_response.json()
    assert deleted_payload["ok"] is True
    assert deleted_payload["id"] == placed["id"]

    assert map_response.status_code == 200
    payload = map_response.json()
    assert not any(p["id"] == placed["id"] for p in payload["placements"])


def test_delete_placement_endpoint_returns_404_for_missing_placement() -> None:
    with TestClient(app) as client:
        response = client.delete("/placements/999999")

    assert response.status_code == 404
    detail = response.json().get("detail", "")
    assert "not found" in detail.lower()


def test_create_architectural_element_endpoint_uses_default_length() -> None:
    room_name = f"API Arch Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    with TestClient(app) as client:
        create_response = client.post(
            f"/rooms/{created['id']}/architectural-elements",
            json={
                "kind": "wall",
                "x_m": 1.0,
                "y_m": 1.0,
            },
        )
        map_response = client.get(f"/rooms/{created['id']}/map")

    assert create_response.status_code == 200
    element = create_response.json()
    assert element["kind"] == "wall"
    assert element["orientation"] == "vertical"
    assert abs(element["length_m"] - 0.9144) < 1e-6
    assert abs(element["thickness_m"] - 0.3048) < 1e-6

    assert map_response.status_code == 200
    payload = map_response.json()
    assert any(e["id"] == element["id"] for e in payload["architectural_elements"])


def test_update_architectural_element_endpoint_cycles_kind_and_orientation() -> None:
    room_name = f"API Arch Update Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    with TestClient(app) as client:
        create_response = client.post(
            f"/rooms/{created['id']}/architectural-elements",
            json={
                "kind": "door",
                "x_m": 1.5,
                "y_m": 2.0,
                "orientation": "vertical",
                "length_m": 1.1,
            },
        )
        element_id = create_response.json()["id"]
        update_response = client.patch(
            f"/architectural-elements/{element_id}",
            json={
                "kind": "window",
                "orientation": "horizontal",
            },
        )

    assert create_response.status_code == 200
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["kind"] == "window"
    assert updated["orientation"] == "horizontal"


def test_update_architectural_element_endpoint_moves_position() -> None:
    room_name = f"API Arch Move Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    with TestClient(app) as client:
        create_response = client.post(
            f"/rooms/{created['id']}/architectural-elements",
            json={
                "kind": "wall",
                "x_m": 1.0,
                "y_m": 1.0,
            },
        )
        element_id = create_response.json()["id"]
        update_response = client.patch(
            f"/architectural-elements/{element_id}",
            json={"x_m": 2.25, "y_m": 3.0},
        )

    assert create_response.status_code == 200
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["x_m"] == 2.25
    assert updated["y_m"] == 3.0


def test_delete_architectural_element_endpoint_removes_element() -> None:
    room_name = f"API Arch Delete Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    with TestClient(app) as client:
        create_response = client.post(
            f"/rooms/{created['id']}/architectural-elements",
            json={
                "kind": "door",
                "x_m": 1.0,
                "y_m": 1.0,
            },
        )
        element_id = create_response.json()["id"]
        delete_response = client.delete(f"/architectural-elements/{element_id}")
        map_response = client.get(f"/rooms/{created['id']}/map")

    assert create_response.status_code == 200
    assert delete_response.status_code == 200
    deleted = delete_response.json()
    assert deleted["ok"] is True
    assert deleted["id"] == element_id

    payload = map_response.json()
    assert not any(e["id"] == element_id for e in payload.get("architectural_elements", []))


def test_update_architectural_element_endpoint_updates_length() -> None:
    room_name = f"API Arch Resize Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    with TestClient(app) as client:
        create_response = client.post(
            f"/rooms/{created['id']}/architectural-elements",
            json={
                "kind": "wall",
                "x_m": 1.0,
                "y_m": 1.0,
                "length_m": 0.9,
            },
        )
        element_id = create_response.json()["id"]
        update_response = client.patch(
            f"/architectural-elements/{element_id}",
            json={"length_m": 1.8},
        )

    assert create_response.status_code == 200
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["length_m"] == 1.8


def test_update_architectural_element_endpoint_updates_thickness() -> None:
    room_name = f"API Arch Thickness Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    with TestClient(app) as client:
        create_response = client.post(
            f"/rooms/{created['id']}/architectural-elements",
            json={
                "kind": "window",
                "x_m": 1.0,
                "y_m": 1.0,
                "thickness_m": 0.3,
            },
        )
        element_id = create_response.json()["id"]
        update_response = client.patch(
            f"/architectural-elements/{element_id}",
            json={"thickness_m": 0.7},
        )

    assert create_response.status_code == 200
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["thickness_m"] == 0.7
