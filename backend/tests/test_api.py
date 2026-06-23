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


def test_create_fixture_endpoint_uses_default_length() -> None:
    room_name = f"API Fixture Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    with TestClient(app) as client:
        create_response = client.post(
            f"/rooms/{created['id']}/fixtures",
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
    assert element["rotation_degrees"] == 0.0
    assert abs(element["length_m"] - 0.9144) < 1e-6
    assert abs(element["thickness_m"] - 0.3048) < 1e-6

    assert map_response.status_code == 200
    payload = map_response.json()
    assert any(e["id"] == element["id"] for e in payload["fixtures"])


def test_update_fixture_endpoint_cycles_kind_and_rotation() -> None:
    room_name = f"API Fixture Update Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    with TestClient(app) as client:
        create_response = client.post(
            f"/rooms/{created['id']}/fixtures",
            json={
                "kind": "door",
                "x_m": 1.5,
                "y_m": 2.0,
                "rotation_degrees": 0.0,
                "length_m": 1.1,
            },
        )
        element_id = create_response.json()["id"]
        update_response = client.patch(
            f"/fixtures/{element_id}",
            json={
                "kind": "window",
                "rotation_degrees": 90.0,
            },
        )

    assert create_response.status_code == 200
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["kind"] == "window"
    assert updated["rotation_degrees"] == 90.0


def test_update_fixture_endpoint_moves_position() -> None:
    room_name = f"API Fixture Move Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    with TestClient(app) as client:
        create_response = client.post(
            f"/rooms/{created['id']}/fixtures",
            json={
                "kind": "wall",
                "x_m": 1.0,
                "y_m": 1.0,
            },
        )
        element_id = create_response.json()["id"]
        update_response = client.patch(
            f"/fixtures/{element_id}",
            json={"x_m": 2.25, "y_m": 3.0},
        )

    assert create_response.status_code == 200
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["x_m"] == 2.25
    assert updated["y_m"] == 3.0


def test_delete_fixture_endpoint_removes_element() -> None:
    room_name = f"API Fixture Delete Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    with TestClient(app) as client:
        create_response = client.post(
            f"/rooms/{created['id']}/fixtures",
            json={
                "kind": "door",
                "x_m": 1.0,
                "y_m": 1.0,
            },
        )
        element_id = create_response.json()["id"]
        delete_response = client.delete(f"/fixtures/{element_id}")
        map_response = client.get(f"/rooms/{created['id']}/map")

    assert create_response.status_code == 200
    assert delete_response.status_code == 200
    deleted = delete_response.json()
    assert deleted["ok"] is True
    assert deleted["id"] == element_id

    payload = map_response.json()
    assert not any(e["id"] == element_id for e in payload.get("fixtures", []))


def test_update_fixture_endpoint_updates_length() -> None:
    room_name = f"API Fixture Resize Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    with TestClient(app) as client:
        create_response = client.post(
            f"/rooms/{created['id']}/fixtures",
            json={
                "kind": "wall",
                "x_m": 1.0,
                "y_m": 1.0,
                "length_m": 0.9,
            },
        )
        element_id = create_response.json()["id"]
        update_response = client.patch(
            f"/fixtures/{element_id}",
            json={"length_m": 1.8},
        )

    assert create_response.status_code == 200
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["length_m"] == 1.8


def test_update_fixture_endpoint_updates_thickness() -> None:
    room_name = f"API Fixture Thickness Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    with TestClient(app) as client:
        create_response = client.post(
            f"/rooms/{created['id']}/fixtures",
            json={
                "kind": "window",
                "x_m": 1.0,
                "y_m": 1.0,
                "thickness_m": 0.3,
            },
        )
        element_id = create_response.json()["id"]
        update_response = client.patch(
            f"/fixtures/{element_id}",
            json={"thickness_m": 0.7},
        )

    assert create_response.status_code == 200
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["thickness_m"] == 0.7


def test_resize_room_endpoint_keeps_in_bounds_and_repositions_out_of_bounds() -> None:
    room_name = f"API Resize Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 6.0, 4.0)
    assert "error" not in created

    kept = tool_place_device(room_name, "sensor.keep_api", "Keep API Sensor", 1.0, 1.0)
    assert "error" not in kept
    moved = tool_place_device(room_name, "sensor.move_api", "Move API Sensor", 5.2, 3.6)
    assert "error" not in moved

    with TestClient(app) as client:
        resize_response = client.patch(
            f"/rooms/{created['id']}",
            json={"width_m": 3.0, "height_m": 2.0},
        )

    assert resize_response.status_code == 200
    payload = resize_response.json()
    assert payload["room"]["width_m"] == 3.0
    assert payload["room"]["height_m"] == 2.0

    kept_after = next(p for p in payload["placements"] if p["id"] == kept["id"])
    moved_after = next(p for p in payload["placements"] if p["id"] == moved["id"])
    assert kept_after["x_m"] == 1.0
    assert kept_after["y_m"] == 1.0
    assert moved_after["x_m"] == 1.5
    assert moved_after["y_m"] == 1.0


def test_resize_room_endpoint_returns_400_for_invalid_dimensions() -> None:
    room_name = f"API Resize Invalid {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 4.0, 3.0)
    assert "error" not in created

    with TestClient(app) as client:
        response = client.patch(
            f"/rooms/{created['id']}",
            json={"width_m": -1.0, "height_m": 2.0},
        )

    assert response.status_code == 400
    detail = response.json().get("detail", "")
    assert "positive" in detail.lower()


def test_resize_room_endpoint_returns_404_for_missing_room() -> None:
    with TestClient(app) as client:
        response = client.patch(
            "/rooms/999999",
            json={"width_m": 3.0, "height_m": 2.0},
        )

    assert response.status_code == 404
    detail = response.json().get("detail", "")
    assert "not found" in detail.lower()


def test_delete_room_endpoint_removes_room_and_associated_data() -> None:
    room_name = f"API Delete Room {uuid4().hex[:8]}"
    created = tool_create_room(room_name, 5.0, 4.0)
    assert "error" not in created

    placed = tool_place_device(room_name, "light.del_room", "Del Room Light", 1.0, 1.0)
    assert "error" not in placed

    with TestClient(app) as client:
        # Verify room exists before deletion
        rooms_before = client.get("/rooms")
        assert rooms_before.status_code == 200
        assert any(r["id"] == created["id"] for r in rooms_before.json())

        # Delete the room
        delete_response = client.delete(f"/rooms/{created['id']}")
        assert delete_response.status_code == 200
        deleted = delete_response.json()
        assert deleted["ok"] is True
        assert deleted["id"] == created["id"]

        # Verify room is gone
        rooms_after = client.get("/rooms")
        assert rooms_after.status_code == 200
        assert not any(r["id"] == created["id"] for r in rooms_after.json())

        # Verify map returns 404
        map_response = client.get(f"/rooms/{created['id']}/map")
        assert map_response.status_code == 404


def test_delete_room_endpoint_returns_404_for_missing_room() -> None:
    with TestClient(app) as client:
        response = client.delete("/rooms/999999")

    assert response.status_code == 404
    detail = response.json().get("detail", "")
    assert "not found" in detail.lower()


def test_floors_endpoint_lists_created_floors() -> None:
    floor_name = f"API Floor {uuid4().hex[:8]}"
    with TestClient(app) as client:
        create_response = client.post("/floors", json={"name": floor_name, "level": 2})
        assert create_response.status_code == 201
        created = create_response.json()
        assert created["name"] == floor_name
        assert created["level"] == 2

        list_response = client.get("/floors")
        assert list_response.status_code == 200
        floors = list_response.json()
        assert any(f["id"] == created["id"] and f["name"] == floor_name for f in floors)


def test_floors_endpoint_rejects_duplicate_name() -> None:
    floor_name = f"API Dup Floor {uuid4().hex[:8]}"
    with TestClient(app) as client:
        first = client.post("/floors", json={"name": floor_name, "level": 1})
        assert first.status_code == 201

        second = client.post("/floors", json={"name": floor_name, "level": 2})
        assert second.status_code == 400


def test_delete_floor_endpoint_removes_floor() -> None:
    floor_name = f"API Del Floor {uuid4().hex[:8]}"
    with TestClient(app) as client:
        create_response = client.post("/floors", json={"name": floor_name, "level": 1})
        assert create_response.status_code == 201
        floor_id = create_response.json()["id"]

        delete_response = client.delete(f"/floors/{floor_id}")
        assert delete_response.status_code == 200

        floors_after = client.get("/floors").json()
        assert not any(f["id"] == floor_id for f in floors_after)


def test_delete_floor_endpoint_returns_404_for_missing_floor() -> None:
    with TestClient(app) as client:
        response = client.delete("/floors/999999")
    assert response.status_code == 404


def test_rooms_include_floor_id() -> None:
    room_name = f"API FloorRoom {uuid4().hex[:8]}"
    with TestClient(app) as client:
        floor_response = client.post("/floors", json={"name": f"Floor for {room_name}", "level": 1})
        assert floor_response.status_code == 201
        floor_id = floor_response.json()["id"]

        room_response = client.get("/rooms")
        assert room_response.status_code == 200
        rooms = room_response.json()
        # All rooms should have a floor_id field (may be null)
        for room in rooms:
            assert "floor_id" in room
