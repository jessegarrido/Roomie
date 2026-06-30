# HA Agent Capstone (Chat + Tool Calling)

- Frontend: Next.js chat UI with room map preview.
- Backend: FastAPI tool-calling API with SQLite persistence.
- Mock Home Assistant mode so the app works even without a real HA token.

## Project Layout

- `frontend/`: Next.js app with chat interface and SVG map preview.
- `backend/`: FastAPI app with tools and SQLite models.
- `.vscode/tasks.json`: Run tasks for frontend and backend.

## Tools Implemented

- `discover_devices`
- `create_room`
- `list_rooms`
- `place_device`
- `move_device`
- `render_room_map`

## Linux Setup

## 1) Install prerequisites

- Node.js 20+ and npm
- Python 3.11+

If npm is missing on Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y nodejs npm
```

## 2) Backend setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

## 3) Frontend setup

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## Demo Script

In chat, type:

1. `discover devices`
2. `create living room 5 by 4`
3. `place light.living_room_lamp at 1.5,2 in living room`
4. `show map for living room`

You should see the room map update in the right panel.

## Test Backend

```bash
cd backend
source .venv/bin/activate
PYTHONPATH=. pytest -q
```

Tests use an autouse fixture in `backend/tests/conftest.py` that creates a temporary SQLite database per test for isolation.

## Notes

- Home Assistant discovery now uses `GET /api/states` when `HA_USE_MOCK=false`.
- Configure `HA_BASE_URL` and `HA_TOKEN` in `backend/.env` for live mode.
- `HA_FALLBACK_TO_MOCK=true` keeps demo reliability if HA is unreachable.
- `HA_TIMEOUT_SECONDS` controls request timeout for HA API calls.
- Logging can be configured with `LOG_LEVEL` and `LOG_FORMAT` in `backend/.env`.

## Enable Live Home Assistant Mode

1. In `backend/.env`, set:
	- `HA_USE_MOCK=false`
	- `HA_BASE_URL=http://<your-ha-host>:8123`
	- `HA_TOKEN=<long-lived-access-token>`
2. Restart backend.
3. In chat, run `discover devices` to pull live entities.

`discover_devices` reads entity state and attributes from Home Assistant and returns `entity_id`, `name`, `domain`, and best-effort `area`.
