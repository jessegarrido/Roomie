import os
import logging
from typing import List, Dict, Any

import httpx


MOCK_DEVICES = [
    {"entity_id": "light.living_room_lamp", "name": "Living Room Lamp", "domain": "light", "area": "Living Room", "state": "on"},
    {"entity_id": "sensor.kitchen_temp", "name": "Kitchen Temp", "domain": "sensor", "area": "Kitchen", "state": "22.5"},
    {"entity_id": "fan.office_fan", "name": "Office Fan", "domain": "fan", "area": "Office", "state": "on"},
    {"entity_id": "light.bedroom_light", "name": "Bedroom Light", "domain": "light", "area": "Bedroom", "state": "off"},
    {"entity_id": "fan.bedroom_fan", "name": "Bedroom Fan", "domain": "fan", "area": "Bedroom", "state": "off"},
]

MOCK_STATES = {
    "light.living_room_lamp": "on",
    "sensor.kitchen_temp": "22.5",
    "fan.office_fan": "on",
    "light.bedroom_light": "off",
    "fan.bedroom_fan": "off",
}

logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _discover_from_states(base_url: str, token: str, timeout_s: float) -> List[Dict[str, Any]]:
    url = f"{base_url.rstrip('/')}/api/states"
    headers = {"Authorization": f"Bearer {token}"}

    with httpx.Client(timeout=timeout_s, headers=headers) as client:
        response = client.get(url)
        response.raise_for_status()
        states = response.json()

    discovered: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for row in states:
        entity_id = row.get("entity_id")
        if not entity_id or "." not in entity_id:
            continue
        domain = entity_id.split(".", 1)[0]
        if domain in {"automation", "calendar"}:
            continue
        if entity_id in seen:
            continue

        attrs = row.get("attributes") or {}
        discovered.append(
            {
                "entity_id": entity_id,
                "name": attrs.get("friendly_name") or entity_id,
                "domain": domain,
                "area": attrs.get("area_name")
                or attrs.get("area")
                or attrs.get("room")
                or attrs.get("suggested_area")
                or attrs.get("area_id"),
                "state": row.get("state"),
            }
        )
        seen.add(entity_id)

    discovered.sort(key=lambda d: d["entity_id"])
    return discovered


def discover_devices() -> List[Dict[str, Any]]:
    use_mock = _env_bool("HA_USE_MOCK", True)
    fallback_to_mock = _env_bool("HA_FALLBACK_TO_MOCK", True)
    timeout_s = float(os.getenv("HA_TIMEOUT_SECONDS", "8"))

    if use_mock:
        return MOCK_DEVICES

    base_url = os.getenv("HA_BASE_URL")
    token = os.getenv("HA_TOKEN")
    if not base_url or not token:
        if fallback_to_mock:
            logger.warning("HA_BASE_URL or HA_TOKEN missing; falling back to mock devices.")
            return MOCK_DEVICES
        return []

    try:
        devices = _discover_from_states(base_url=base_url, token=token, timeout_s=timeout_s)
        if devices:
            return devices
        if fallback_to_mock:
            logger.warning("No devices returned from Home Assistant; falling back to mock devices.")
            return MOCK_DEVICES
        return []
    except (httpx.HTTPError, ValueError) as exc:
        if fallback_to_mock:
            logger.warning("Home Assistant discovery failed (%s); falling back to mock devices.", exc)
            return MOCK_DEVICES
        return []


def get_device_states() -> Dict[str, str]:
    """Return a mapping of entity_id -> state string for all known devices.

    When connected to Home Assistant, fetches live states from /api/states.
    When using mock devices, returns the hardcoded MOCK_STATES dict.
    """
    use_mock = _env_bool("HA_USE_MOCK", True)
    fallback_to_mock = _env_bool("HA_FALLBACK_TO_MOCK", True)
    timeout_s = float(os.getenv("HA_TIMEOUT_SECONDS", "8"))

    if use_mock:
        return dict(MOCK_STATES)

    base_url = os.getenv("HA_BASE_URL")
    token = os.getenv("HA_TOKEN")
    if not base_url or not token:
        if fallback_to_mock:
            logger.warning("HA_BASE_URL or HA_TOKEN missing; falling back to mock states.")
            return dict(MOCK_STATES)
        return {}

    try:
        url = f"{base_url.rstrip('/')}/api/states"
        headers = {"Authorization": f"Bearer {token}"}
        with httpx.Client(timeout=timeout_s, headers=headers) as client:
            response = client.get(url)
            response.raise_for_status()
            states = response.json()

        result: Dict[str, str] = {}
        for row in states:
            entity_id = row.get("entity_id")
            if entity_id and "." in entity_id:
                result[entity_id] = row.get("state", "")
        return result
    except (httpx.HTTPError, ValueError) as exc:
        if fallback_to_mock:
            logger.warning("Home Assistant state fetch failed (%s); falling back to mock states.", exc)
            return dict(MOCK_STATES)
        return {}
