from app.ha_client import _discover_from_states


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, payload):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def get(self, _url: str) -> _FakeResponse:
        return _FakeResponse(self._payload)


def test_discovery_excludes_automation_and_calendar_domains(monkeypatch) -> None:
    states = [
        {
            "entity_id": "automation.good_morning",
            "state": "on",
            "attributes": {"friendly_name": "Good Morning"},
        },
        {
            "entity_id": "calendar.family",
            "state": "on",
            "attributes": {"friendly_name": "Family Calendar"},
        },
        {
            "entity_id": "light.kitchen_main",
            "state": "off",
            "attributes": {"friendly_name": "Kitchen Main", "area_name": "Kitchen"},
        },
    ]

    import app.ha_client as ha_client

    monkeypatch.setattr(ha_client.httpx, "Client", lambda **_kwargs: _FakeClient(states))

    discovered = _discover_from_states("http://example.local", "token", 5)

    assert len(discovered) == 1
    assert discovered[0]["entity_id"] == "light.kitchen_main"
    assert discovered[0]["domain"] == "light"
