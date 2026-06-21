from .database import init_db
from .tools import tool_create_room, tool_create_floor, tool_place_device


def seed() -> None:
    init_db()
    tool_create_floor("Ground Floor", level=1)
    tool_create_floor("Upper Floor", level=2)
    tool_create_room("Living Room", 5.0, 4.0, floor_id=1)
    tool_place_device("Living Room", "light.living_room_lamp", "Living Room Lamp", 1.2, 2.1)


if __name__ == "__main__":
    seed()
    print("Seed complete")
