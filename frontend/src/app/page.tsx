"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import RoomMapPreview from "@/components/RoomMapPreview";
import FloorMapPreview from "@/components/FloorMapPreview";
import type { ChatMessage, DiscoveredDevice, FloorSummary, RoomMapResponse, RoomSummary } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
function getWelcomeMessage(unit: "m" | "ft"): string {
  return unit === "ft"
    ? "Try: 'discover my devices', 'create living room 16 by 13 feet', 'place desk lamp at 3,6 in living room', or 'show map for living room'."
    : "Try: 'discover my devices', 'create living room 5 by 4', 'place desk lamp at 1,2 in living room', or 'show map for living room'.";
}

export default function Home() {
  const mapPanelRef = useRef<HTMLElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const [recording, setRecording] = useState(false);
  const [chatHeight, setChatHeight] = useState<number | null>(null);
  const [devicesFlex, setDevicesFlex] = useState(80);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartFlex = useRef(0);
  const chatPanelRef = useRef<HTMLElement | null>(null);
  const [leftColPercent, setLeftColPercent] = useState(55);
  const isColDragging = useRef(false);
  const colDragStartX = useRef(0);
  const colDragStartPercent = useRef(0);
  const mainRef = useRef<HTMLElement | null>(null);
  const [viewMode, setViewMode] = useState<"planner" | "layout">("planner");
  const [unit, setUnit] = useState<"m" | "ft">("ft");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
        content: getWelcomeMessage("ft"),
    },
  ]);
  const [input, setInput] = useState("");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [deviceSearchResults, setDeviceSearchResults] = useState<DiscoveredDevice[] | null>(null);
  const [deviceSearchLoading, setDeviceSearchLoading] = useState(false);
  const deviceSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [floors, setFloors] = useState<FloorSummary[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<number | null>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("selectedFloorId");
      return saved ? Number(saved) : null;
    }
    return null;
  });
  const [roomMapsById, setRoomMapsById] = useState<Record<number, RoomMapResponse>>({});
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [hiddenLabelIds, setHiddenLabelIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [renamingRoomId, setRenamingRoomId] = useState<number | null>(null);
  const [renamingFloorId, setRenamingFloorId] = useState<number | null>(null);
  const [renamingRoomName, setRenamingRoomName] = useState("");
  const [renamingFloorName, setRenamingFloorName] = useState("");
  const [roomPositionsByFloor, setRoomPositionsByFloor] = useState<Record<number, Record<number, { x: number; y: number }>>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("roomPositionsByFloor");
        return saved ? (JSON.parse(saved) as Record<number, Record<number, { x: number; y: number }>>) : {};
      } catch {
        return {};
      }
    }
    return {};
  });
  const unitHint =
    unit === "ft"
      ? "Try: create living room 16 by 13 feet, place desk lamp at 3,6 in living room"
      : "Try: create living room 5 by 4, place desk lamp at 1,2 in living room";

  const onResizeHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartFlex.current = devicesFlex;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [devicesFlex]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const panel = chatPanelRef.current;
      if (!panel) return;
      const delta = e.clientY - dragStartY.current;
      const panelHeight = panel.getBoundingClientRect().height;
      if (panelHeight === 0) return;
      const flexDelta = (delta / panelHeight) * 100;
      const nextFlex = Math.min(80, Math.max(15, dragStartFlex.current - flexDelta));
      setDevicesFlex(nextFlex);
    };

    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const onColResizeHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isColDragging.current = true;
    colDragStartX.current = e.clientX;
    colDragStartPercent.current = leftColPercent;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [leftColPercent]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isColDragging.current) return;
      const main = mainRef.current;
      if (!main) return;
      const rect = main.getBoundingClientRect();
      if (rect.width === 0) return;
      const delta = e.clientX - colDragStartX.current;
      const percentDelta = (delta / rect.width) * 100;
      const raw = colDragStartPercent.current + percentDelta;
      // Snap to 0 (collapsed) when below 10%; otherwise clamp to [0, 80]
      const nextPercent = raw < 10 ? 0 : Math.min(80, Math.max(0, raw));
      setLeftColPercent(nextPercent);
    };

    const onMouseUp = () => {
      if (!isColDragging.current) return;
      isColDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    const updatedWelcome = getWelcomeMessage(unit);
    setMessages((prev) => {
      if (prev.length === 0 || prev[0].role !== "assistant") {
        return prev;
      }
      if (prev[0].content === updatedWelcome) {
        return prev;
      }
      const next = [...prev];
      next[0] = { ...next[0], content: updatedWelcome };
      return next;
    });
  }, [unit]);

  const refreshDiscoveredDevices = useCallback(async () => {
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const res = await fetch(`${API_BASE}/devices`);
      if (!res.ok) throw new Error("Devices request failed");
      const data = (await res.json()) as DiscoveredDevice[];
      setDevices(data);
    } catch {
      setDevicesError("Failed to load discovered devices.");
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshDiscoveredDevices();
  }, [refreshDiscoveredDevices]);

  // Debounced embedding-based device search
  useEffect(() => {
    if (deviceSearchTimeout.current) clearTimeout(deviceSearchTimeout.current);
    if (!deviceSearch.trim()) {
      setDeviceSearchResults(null);
      setDeviceSearchLoading(false);
      return;
    }
    setDeviceSearchLoading(true);
    deviceSearchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/devices/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: deviceSearch.trim(), top_k: 20 }),
        });
        if (!res.ok) throw new Error("Search failed");
        const data = (await res.json()) as { results: DiscoveredDevice[] };
        setDeviceSearchResults(data.results ?? null);
      } catch {
        setDeviceSearchResults(null);
      } finally {
        setDeviceSearchLoading(false);
      }
    }, 300);
    return () => {
      if (deviceSearchTimeout.current) clearTimeout(deviceSearchTimeout.current);
    };
  }, [deviceSearch]);

  const refreshRooms = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/rooms`);
      if (!res.ok) return;
      const data = (await res.json()) as RoomSummary[];
      setRooms(data);
      setSelectedRoomId((current) => {
        if (current !== null && data.some((r) => r.id === current)) return current;
        return data.length > 0 ? data[0].id : null;
      });
    } catch {
      // Keep the current room selection if the backend is temporarily unavailable.
    }
  }, []);

  const deleteRoom = useCallback(
    async (roomId: number): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE}/rooms/${roomId}`, {
          method: "DELETE",
        });
        if (!res.ok) return false;

        setRoomMapsById((prev) => {
          const next = { ...prev };
          delete next[roomId];
          return next;
        });
        setSelectedRoomId((current) => {
          if (current === roomId) return null;
          return current;
        });
        // Room deleted, layoutRooms will auto-update
        await refreshRooms();
        return true;
      } catch {
        return false;
      }
    },
    [refreshRooms],
  );

  const createRoom = useCallback(
    async (name: string, width_m: number, height_m: number): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE}/rooms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, width_m, height_m }),
        });
        if (!res.ok) return false;
        await refreshRooms();
        return true;
      } catch {
        return false;
      }
    },
    [refreshRooms],
  );

  const refreshFloors = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/floors`);
      if (!res.ok) return;
      const data = (await res.json()) as FloorSummary[];
      setFloors(data);
    } catch {
      // Keep current floors if backend is temporarily unavailable.
    }
  }, []);

  const createFloor = useCallback(
    async (name: string, level: number): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE}/floors`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, level }),
        });
        if (!res.ok) return false;
        await refreshFloors();
        return true;
      } catch {
        return false;
      }
    },
    [refreshFloors],
  );

  const deleteFloor = useCallback(
    async (floorId: number): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE}/floors/${floorId}`, {
          method: "DELETE",
        });
        if (!res.ok) return false;
        if (selectedFloorId === floorId) {
          setSelectedFloorId(null);
          localStorage.removeItem("selectedFloorId");
        }
        // Clean up saved positions for the deleted floor
        setRoomPositionsByFloor((prev) => {
          const next = { ...prev };
          delete next[floorId];
          localStorage.setItem("roomPositionsByFloor", JSON.stringify(next));
          return next;
        });
        await refreshFloors();
        await refreshRooms();
        return true;
      } catch {
        return false;
      }
    },
    [selectedFloorId, refreshFloors, refreshRooms],
  );

  const renameRoom = useCallback(
    async (roomId: number, name: string): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE}/rooms/${roomId}/rename`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        await refreshRooms();
        return true;
      } catch {
        return false;
      }
    },
    [refreshRooms],
  );

  const renameFloor = useCallback(
    async (floorId: number, name: string): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE}/floors/${floorId}/rename`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        await refreshFloors();
        return true;
      } catch {
        return false;
      }
    },
    [refreshFloors],
  );

  useEffect(() => {
    let active = true;

    const loadFloors = async () => {
      if (!active) return;
      await refreshFloors();
    };

    loadFloors();
    const retryId = window.setInterval(() => {
      if (active && floors.length === 0) {
        void refreshFloors();
      }
    }, 2000);

    return () => {
      active = false;
      window.clearInterval(retryId);
    };
  }, [refreshFloors, floors.length]);

  // Auto-select first floor when floors load and no floor is selected,
  // or fall back to first floor if selected floor no longer exists
  useEffect(() => {
    if (floors.length === 0) return;
    if (selectedFloorId === null || !floors.some((f) => f.id === selectedFloorId)) {
      const firstId = floors[0].id;
      setSelectedFloorId(firstId);
      localStorage.setItem("selectedFloorId", String(firstId));
    }
  }, [floors, selectedFloorId]);

  useEffect(() => {
    let active = true;

    const loadRooms = async () => {
      if (!active) return;
      await refreshRooms();
    };

    loadRooms();
    const retryId = window.setInterval(() => {
      if (active && rooms.length === 0) {
        void refreshRooms();
      }
    }, 2000);

    return () => {
      active = false;
      window.clearInterval(retryId);
    };
  }, [refreshRooms, rooms.length]);

  useEffect(() => {
    if (selectedRoomId === null || roomMapsById[selectedRoomId]) return;
    let active = true;

    async function fetchRoomMap(roomId: number) {
      try {
        const res = await fetch(`${API_BASE}/rooms/${roomId}/map`);
        if (!res.ok) return;
        const data = (await res.json()) as RoomMapResponse;
        if (!active) return;
        setRoomMapsById((prev) => ({ ...prev, [roomId]: data }));
      } catch {
        // Keep current map data untouched on transient failures.
      }
    }

    fetchRoomMap(selectedRoomId);
    return () => {
      active = false;
    };
  }, [selectedRoomId, roomMapsById]);

  useEffect(() => {
    const mapPanel = mapPanelRef.current;
    if (!mapPanel || typeof ResizeObserver === "undefined") return;

    const syncHeight = () => {
      if (window.innerWidth < 920) {
        setChatHeight(null);
        return;
      }
      setChatHeight(Math.round(mapPanel.getBoundingClientRect().height));
    };

    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(mapPanel);
    window.addEventListener("resize", syncHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncHeight);
    };
  }, []);

  const toggleListening = useCallback(() => {
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setMessages((m) => [...m, { role: "assistant", content: "Voice input is not supported in this browser. Try Chrome or Edge." }]);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      setRecording(false);
      // Auto-submit the captured text
      const form = document.querySelector(".chat-form") as HTMLFormElement | null;
      if (form) form.requestSubmit();
    };

    recognition.onerror = () => {
      setRecording(false);
    };

    recognition.onend = () => {
      setRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  }, [recording]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    const shouldRefreshDevices = /discover|devices?/i.test(text);

    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: messages.map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok) throw new Error("Chat request failed");
      const data = (await res.json()) as { reply: string; map_data?: RoomMapResponse | null };

      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      if (data.map_data) {
        const roomId = data.map_data.room.id;
        setRoomMapsById((prev) => ({ ...prev, [roomId]: data.map_data as RoomMapResponse }));
        setRooms((prev) => {
          const room = data.map_data?.room;
          if (!room) return prev;
          const exists = prev.some((r) => r.id === room.id);
          if (exists) {
            return prev.map((r) => (r.id === room.id ? { ...r, ...room } : r));
          }
          return [...prev, room];
        });
        setSelectedRoomId(roomId);
      }
      if (shouldRefreshDevices) {
        await refreshDiscoveredDevices();
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Request failed. Is backend running?" }]);
    } finally {
      setLoading(false);
    }
  }

  const selectedMapData = selectedRoomId === null ? null : roomMapsById[selectedRoomId] ?? null;
  const filteredDevices = deviceSearch.trim()
    ? (deviceSearchResults ?? devices)
    : devices;

  const layoutRooms = selectedFloorId === null
    ? rooms
    : rooms.filter((room) => room.floor_id === selectedFloorId);
  const layoutRoomIds = layoutRooms.map((room) => room.id);

  // Fetch room maps for all layout rooms when switching to layout view
  useEffect(() => {
    if (viewMode !== "layout") return;
    let active = true;

    async function fetchLayoutRoomMaps() {
      for (const roomId of layoutRoomIds) {
        if (roomMapsById[roomId]) continue;
        try {
          const res = await fetch(`${API_BASE}/rooms/${roomId}/map`);
          if (!res.ok) continue;
          const data = (await res.json()) as RoomMapResponse;
          if (!active) return;
          setRoomMapsById((prev) => ({ ...prev, [roomId]: data }));
        } catch {
          // Skip transient failures silently
        }
      }
    }

    fetchLayoutRoomMaps();
    return () => {
      active = false;
    };
  }, [viewMode, layoutRoomIds, roomMapsById]);

  const movePlacement = useCallback(
    async (placementId: number, x_m: number, y_m: number): Promise<boolean> => {
      if (selectedRoomId === null) return false;

      try {
        const res = await fetch(`${API_BASE}/placements/${placementId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x_m, y_m }),
        });

        if (!res.ok) return false;
        const moved = (await res.json()) as { id: number; x_m: number; y_m: number };

        setRoomMapsById((prev) => {
          const currentMap = prev[selectedRoomId];
          if (!currentMap) return prev;
          return {
            ...prev,
            [selectedRoomId]: {
              ...currentMap,
              placements: currentMap.placements.map((placement) =>
                placement.id === moved.id
                  ? { ...placement, x_m: moved.x_m, y_m: moved.y_m }
                  : placement,
              ),
            },
          };
        });

        return true;
      } catch {
        return false;
      }
    },
    [selectedRoomId],
  );

  const createPlacementFromDrop = useCallback(
    async (device: { entity_id: string; name: string }, x_m: number, y_m: number): Promise<boolean> => {
      if (selectedRoomId === null) return false;

      try {
        const res = await fetch(`${API_BASE}/rooms/${selectedRoomId}/placements`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entity_id: device.entity_id,
            label: device.name,
            x_m,
            y_m,
          }),
        });

        if (!res.ok) return false;
        const created = (await res.json()) as {
          id: number;
          entity_id: string;
          label: string;
          x_m: number;
          y_m: number;
        };

        setRoomMapsById((prev) => {
          const currentMap = prev[selectedRoomId];
          if (!currentMap) return prev;
          const exists = currentMap.placements.some((placement) => placement.id === created.id);
          if (exists) return prev;

          return {
            ...prev,
            [selectedRoomId]: {
              ...currentMap,
              placements: [...currentMap.placements, created],
            },
          };
        });
        return true;
      } catch {
        return false;
      }
    },
    [selectedRoomId],
  );

  const deletePlacement = useCallback(
    async (placementId: number): Promise<boolean> => {
      if (selectedRoomId === null) return false;

      try {
        const res = await fetch(`${API_BASE}/placements/${placementId}`, {
          method: "DELETE",
        });
        if (!res.ok) return false;

        setRoomMapsById((prev) => {
          const currentMap = prev[selectedRoomId];
          if (!currentMap) return prev;
          return {
            ...prev,
            [selectedRoomId]: {
              ...currentMap,
              placements: currentMap.placements.filter((placement) => placement.id !== placementId),
            },
          };
        });
        return true;
      } catch {
        return false;
      }
    },
    [selectedRoomId],
  );

  const updateFixture = useCallback(
    async (
      elementId: number,
      patch: { kind?: "wall" | "door" | "window" | "stairs" | "void" | "desk" | "sofa" | "entry" | "sink" | "fixture"; rotation_degrees?: number },
    ): Promise<boolean> => {
      if (selectedRoomId === null) return false;
      try {
        const res = await fetch(`${API_BASE}/fixtures/${elementId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) return false;

        const updated = (await res.json()) as {
          id: number;
          kind: "wall" | "door" | "window" | "stairs" | "void" | "desk" | "sofa" | "entry" | "sink" | "fixture";
          rotation_degrees: number;
        };

        setRoomMapsById((prev) => {
          const currentMap = prev[selectedRoomId];
          if (!currentMap) return prev;
          return {
            ...prev,
            [selectedRoomId]: {
              ...currentMap,
              fixtures: (currentMap.fixtures ?? []).map((element) =>
                element.id === updated.id
                  ? { ...element, kind: updated.kind, rotation_degrees: updated.rotation_degrees }
                  : element,
              ),
            },
          };
        });

        return true;
      } catch {
        return false;
      }
    },
    [selectedRoomId],
  );

  const moveFixture = useCallback(
    async (elementId: number, x_m: number, y_m: number): Promise<boolean> => {
      if (selectedRoomId === null) return false;
      try {
        const res = await fetch(`${API_BASE}/fixtures/${elementId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x_m, y_m }),
        });
        if (!res.ok) return false;

        const updated = (await res.json()) as { id: number; x_m: number; y_m: number };
        setRoomMapsById((prev) => {
          const currentMap = prev[selectedRoomId];
          if (!currentMap) return prev;
          return {
            ...prev,
            [selectedRoomId]: {
              ...currentMap,
              fixtures: (currentMap.fixtures ?? []).map((element) =>
                element.id === updated.id
                  ? { ...element, x_m: updated.x_m, y_m: updated.y_m }
                  : element,
              ),
            },
          };
        });
        return true;
      } catch {
        return false;
      }
    },
    [selectedRoomId],
  );

  const deleteFixture = useCallback(
    async (elementId: number): Promise<boolean> => {
      if (selectedRoomId === null) return false;
      try {
        const res = await fetch(`${API_BASE}/fixtures/${elementId}`, {
          method: "DELETE",
        });
        if (!res.ok) return false;

        setRoomMapsById((prev) => {
          const currentMap = prev[selectedRoomId];
          if (!currentMap) return prev;
          return {
            ...prev,
            [selectedRoomId]: {
              ...currentMap,
              fixtures: (currentMap.fixtures ?? []).filter(
                (element) => element.id !== elementId,
              ),
            },
          };
        });
        return true;
      } catch {
        return false;
      }
    },
    [selectedRoomId],
  );

  const resizeFixture = useCallback(
    async (
      elementId: number,
      patch: {
        length_m: number;
        x_m?: number;
        y_m?: number;
        thickness_m?: number;
        rotation_degrees?: number;
      },
    ): Promise<boolean> => {
      if (selectedRoomId === null) return false;
      try {
        const res = await fetch(`${API_BASE}/fixtures/${elementId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) return false;

        const updated = (await res.json()) as {
          id: number;
          length_m: number;
          thickness_m: number;
          x_m: number;
          y_m: number;
          rotation_degrees: number;
        };
        setRoomMapsById((prev) => {
          const currentMap = prev[selectedRoomId];
          if (!currentMap) return prev;
          return {
            ...prev,
            [selectedRoomId]: {
              ...currentMap,
              fixtures: (currentMap.fixtures ?? []).map((element) =>
                element.id === updated.id
                  ? {
                      ...element,
                      length_m: updated.length_m,
                      thickness_m: updated.thickness_m,
                      x_m: updated.x_m,
                      y_m: updated.y_m,
                      rotation_degrees: updated.rotation_degrees,
                    }
                  : element,
              ),
            },
          };
        });
        return true;
      } catch {
        return false;
      }
    },
    [selectedRoomId],
  );

  const insertFixture = useCallback(async (): Promise<void> => {
    if (selectedRoomId === null) return;

    const selectedRoom = selectedMapData?.room ?? rooms.find((room) => room.id === selectedRoomId);
    if (!selectedRoom) return;

    const x_m = Number((selectedRoom.width_m / 2).toFixed(3));
    const y_m = Number((selectedRoom.height_m / 2).toFixed(3));

    try {
      const res = await fetch(`${API_BASE}/rooms/${selectedRoomId}/fixtures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "wall",
          x_m,
          y_m,
        }),
      });
      if (!res.ok) return;

      const created = (await res.json()) as {
        id: number;
        kind: "wall" | "door" | "window" | "stairs" | "void" | "desk" | "sofa" | "entry" | "sink" | "fixture";
        rotation_degrees: number;
        length_m: number;
        thickness_m: number;
        x_m: number;
        y_m: number;
      };

      setRoomMapsById((prev) => {
        const currentMap = prev[selectedRoomId];
        if (!currentMap) return prev;
        return {
          ...prev,
          [selectedRoomId]: {
            ...currentMap,
            fixtures: [...(currentMap.fixtures ?? []), created],
          },
        };
      });
    } catch {
      // Ignore transient insert failures and keep current UI state.
    }
  }, [selectedRoomId, selectedMapData, rooms]);

  const assignDevices = useCallback(async (): Promise<void> => {
    if (selectedRoomId === null) return;
    const selectedRoom = selectedMapData?.room ?? rooms.find((room) => room.id === selectedRoomId);
    if (!selectedRoom) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Use the inspect_and_assign_devices_to_room tool to add devices to the room "${selectedRoom.name}".`,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { reply: string; map_data?: RoomMapResponse | null };
      if (data.map_data) {
        setRoomMapsById((prev) => ({ ...prev, [selectedRoomId]: data.map_data as RoomMapResponse }));
      }
    } catch {
      // Ignore errors; chat handles failure display.
    } finally {
      setLoading(false);
    }
  }, [selectedRoomId, selectedMapData, rooms]);

  const resizeRoom = useCallback(
    async (width_m: number, height_m: number): Promise<boolean> => {
      if (selectedRoomId === null) return false;
      try {
        const res = await fetch(`${API_BASE}/rooms/${selectedRoomId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ width_m, height_m }),
        });
        if (!res.ok) return false;

        const updatedMap = (await res.json()) as RoomMapResponse;
        setRoomMapsById((prev) => ({ ...prev, [selectedRoomId]: updatedMap }));
        return true;
      } catch {
        return false;
      }
    },
    [selectedRoomId],
  );

  const handleSaveRoomPositions = useCallback(
    (positions: Record<number, { x: number; y: number }>) => {
      if (selectedFloorId === null) return;
      setRoomPositionsByFloor((prev) => {
        const next = { ...prev, [selectedFloorId]: positions };
        localStorage.setItem("roomPositionsByFloor", JSON.stringify(next));
        return next;
      });
    },
    [selectedFloorId],
  );

  const currentFloorPositions = selectedFloorId !== null ? roomPositionsByFloor[selectedFloorId] : undefined;

  return (
    <main
      ref={mainRef}
      className={`main${leftColPercent === 0 ? " left-col-collapsed" : ""}`}
      style={{ "--left-col": `${leftColPercent}%` } as React.CSSProperties}
    >
      <section ref={chatPanelRef} className="panel chat" style={chatHeight ? { height: `${chatHeight}px` } : undefined}>
        <div className="chat-header">
          <h1>HA Agent Planner</h1>
          <p>Chat-first room planning with tool calls.</p>
          <div className="view-switch" role="tablist" aria-label="View mode">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "planner"}
              className={viewMode === "planner" ? "is-active" : ""}
              onClick={() => setViewMode("planner")}
            >
              Rooms
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "layout"}
              className={viewMode === "layout" ? "is-active" : ""}
              onClick={() => setViewMode("layout")}
            >
              Floors
            </button>
          </div>
        </div>

        <div className="messages" style={{ flex: `1 1 ${100 - devicesFlex}%` }}>
          <div className="messages-spacer" />
          {messages.map((msg, idx) => (
            <div key={idx} className={`msg ${msg.role === "user" ? "msg-user" : "msg-assistant"}`}>
              {msg.content}
            </div>
          ))}
        </div>

        <form className="chat-form" onSubmit={onSubmit}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={unitHint}
          />
          <button type="submit" disabled={loading}>
            {loading ? "..." : "Send"}
          </button>
          <button
            type="button"
            onClick={toggleListening}
            disabled={loading}
            title={recording ? "Stop listening" : "Start voice input"}
            className={recording ? "mic-btn active" : "mic-btn"}
          >
                        {recording ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="6" width="12" height="12" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            )}
          </button>
        </form>

        <div className="resize-handle" onMouseDown={onResizeHandleMouseDown} role="separator" aria-orientation="horizontal" aria-valuenow={devicesFlex} aria-label="Resize devices and chat" />

        {viewMode === "planner" ? (
          <section className="devices-wrap" aria-live="polite" style={{ flex: `1 1 ${devicesFlex}%`, maxHeight: `${devicesFlex}%` }}>
            <div className="devices-header">
              <strong>Discovered Devices</strong>
              <button type="button" onClick={refreshDiscoveredDevices} disabled={devicesLoading}>
                {devicesLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <div className="devices-search-wrap">
              <label htmlFor="devices-search" className="devices-search-label">Search</label>
              <div className="devices-search-input-wrap">
                <input
                  id="devices-search"
                  className="devices-search-input"
                  value={deviceSearch}
                  onChange={(e) => setDeviceSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && deviceSearch.length > 0) {
                      e.preventDefault();
                      setDeviceSearch("");
                    }
                  }}
                  placeholder="Semantic search across name, entity, domain, area…"
                />
                {deviceSearch.length > 0 && (
                  <button
                    type="button"
                    className="devices-search-clear"
                    onClick={() => setDeviceSearch("")}
                    aria-label="Clear device search"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {devicesError && <p className="devices-status">{devicesError}</p>}
            {!devicesError && devices.length === 0 && !devicesLoading && (
              <p className="devices-status">No devices found yet. Ask the chat to discover devices.</p>
            )}
            {!devicesError && devices.length > 0 && filteredDevices.length === 0 && !deviceSearchLoading && (
              <p className="devices-status">No devices match your search.</p>
            )}

            <div className="devices-table-scroll">
              <table className="devices-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Entity ID</th>
                    <th>Domain</th>
                    <th>Area</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDevices.map((device) => (
                    <tr
                      key={device.entity_id}
                      draggable={selectedRoomId !== null}
                      onDragStart={(e) => {
                        if (selectedRoomId === null) return;
                        e.dataTransfer.setData(
                          "application/x-ha-device",
                          JSON.stringify({ entity_id: device.entity_id, name: device.name }),
                        );
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      style={{ cursor: selectedRoomId !== null ? "grab" : "default" }}
                    >
                      <td>{device.name}</td>
                      <td>{device.entity_id}</td>
                      <td>{device.domain}</td>
                      <td>{device.area || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <>
          <section className="rooms-wrap" aria-live="polite" style={{ flex: `1 1 ${devicesFlex}%`, maxHeight: `${devicesFlex}%` }}>
            <div className="devices-header">
              <strong>Rooms</strong>
            </div>
            <div className="devices-table-scroll">
              <table className="devices-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Floor</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((room) => (
                    <tr key={room.id}>
                      <td>
                        {renamingRoomId === room.id ? (
                          <input
                            type="text"
                            value={renamingRoomName}
                            onChange={(e) => setRenamingRoomName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const val = renamingRoomName.trim();
                                if (val && val !== room.name) {
                                  void renameRoom(room.id, val);
                                }
                                setRenamingRoomId(null);
                              }
                              if (e.key === "Escape") {
                                setRenamingRoomId(null);
                              }
                            }}
                            onBlur={() => setRenamingRoomId(null)}
                            autoFocus
                            style={{ fontSize: "0.85em", padding: "2px 4px", width: 120 }}
                          />
                        ) : (
                          <span
                            onClick={() => {
                              setRenamingRoomId(room.id);
                              setRenamingRoomName(room.name);
                            }}
                            style={{ cursor: "pointer" }}
                            title="Click to rename"
                          >
                            {room.name}
                          </span>
                        )}
                      </td>
                      <td>
                        <select
                          value={room.floor_id ?? ""}
                          onChange={(e) => {
                            const floorId = e.target.value ? Number(e.target.value) : null;
                            const query = floorId !== null ? `?floor_id=${floorId}` : "";
                            void (async () => {
                              try {
                                const res = await fetch(`${API_BASE}/rooms/${room.id}/assign-floor${query}`, {
                                  method: "PATCH",
                                });
                                if (res.ok) {
                                  await refreshRooms();
                                }
                              } catch {
                                // ignore transient errors
                              }
                            })();
                          }}
                          style={{ fontSize: "0.85em", padding: "2px 4px" }}
                        >
                          <option value="">—</option>
                          {floors.map((floor) => (
                            <option key={floor.id} value={floor.id}>{floor.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="delete-room-btn"
                          onClick={() => {
                            if (window.confirm(`Delete room "${room.name}"? This cannot be undone.`)) {
                              void deleteRoom(room.id);
                            }
                          }}
                          aria-label="Delete room"
                          title="Delete room"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          </>
        )}
      </section>

      <div className="col-resize-handle" onMouseDown={onColResizeHandleMouseDown} role="separator" aria-orientation="vertical" aria-valuenow={leftColPercent} aria-label="Resize columns" />

      {leftColPercent === 0 && (
        <button
          type="button"
          className="col-expand-btn"
          onClick={() => setLeftColPercent(55)}
          aria-label="Show chat panel"
          title="Show chat panel"
        >
          <span className="col-expand-icon">▶</span>
        </button>
      )}

      <section ref={mapPanelRef} className="panel map-wrap">
        {viewMode === "planner" ? (
          <>
            <RoomMapPreview
              mapData={selectedMapData}
              unit={unit}
              hiddenLabelIds={hiddenLabelIds}
              onToggleLabelVisibility={(id) => {
                setHiddenLabelIds((prev) => {
                  if (prev.has(id)) {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  }
                  const next = new Set(prev);
                  next.add(id);
                  return next;
                });
              }}
              onMovePlacement={movePlacement}
              onDeletePlacement={deletePlacement}
              onMoveFixture={moveFixture}
              onDeleteFixture={deleteFixture}
              onResizeFixture={resizeFixture}
              onUpdateFixture={updateFixture}
              onDropDevice={createPlacementFromDrop}
              onResizeRoom={resizeRoom}
              onSetUnit={setUnit}
              onInsertFixture={insertFixture}
              onAssignDevices={assignDevices}
            />
            <div className="map-control-group" style={{ marginTop: "16px", marginBottom: "8px" }}>
              <label htmlFor="room-select" className="map-label">Room</label>
              <button
                type="button"
                className="cycle-arrow-btn"
                onClick={() => {
                  if (rooms.length === 0) return;
                  const idx = rooms.findIndex((r) => r.id === selectedRoomId);
                  const nextIdx = idx <= 0 ? rooms.length - 1 : idx - 1;
                  setSelectedRoomId(rooms[nextIdx].id);
                }}
                disabled={rooms.length === 0}
                aria-label="Previous room"
                title="Previous room"
              >
                ◀
              </button>
              <select
                id="room-select"
                className="room-select"
                value={selectedRoomId ?? ""}
                onChange={(e) => setSelectedRoomId(e.target.value ? Number(e.target.value) : null)}
                disabled={rooms.length === 0}
              >
                <option value="">Select a room</option>
                {rooms.map((room) => {
                  return (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                className="cycle-arrow-btn"
                onClick={() => {
                  if (rooms.length === 0) return;
                  const idx = rooms.findIndex((r) => r.id === selectedRoomId);
                  const nextIdx = idx < 0 || idx >= rooms.length - 1 ? 0 : idx + 1;
                  setSelectedRoomId(rooms[nextIdx].id);
                }}
                disabled={rooms.length === 0}
                aria-label="Next room"
                title="Next room"
              >
                ▶
              </button>
              {selectedRoomId !== null && (
                <button
                  type="button"
                  className="delete-room-btn"
                  onClick={() => {
                    const room = rooms.find((r) => r.id === selectedRoomId);
                    if (room && window.confirm(`Delete room "${room.name}"? This cannot be undone.`)) {
                      void deleteRoom(selectedRoomId);
                    }
                  }}
                  aria-label="Delete selected room"
                  title="Delete room"
                >
                  ✕
                </button>
              )}
              <button
                type="button"
                className="add-new-btn"
                onClick={() => {
                  const name = window.prompt("Room name:");
                  if (!name) return;
                  const width = window.prompt("Width (m):", "4");
                  if (!width) return;
                  const height = window.prompt("Height (m):", "4");
                  if (!height) return;
                  void createRoom(name, parseFloat(width), parseFloat(height));
                }}
                aria-label="Add new room"
                title="Add room"
                style={{ marginLeft: selectedRoomId !== null ? "4px" : undefined }}
              >
                +
              </button>
            </div>
          </>
        ) : (
          <FloorMapPreview
            rooms={layoutRooms}
            selectedRoomIds={layoutRoomIds}
            unit={unit}
            roomMapsById={roomMapsById}
            savedPositions={currentFloorPositions}
            onSavePositions={handleSaveRoomPositions}
          />
        )}
        <div className="map-controls" style={{ marginTop: "12px" }}>
          {viewMode === "layout" ? (
            <div className="map-control-group">
              <label htmlFor="floor-select" className="map-label">Floor</label>
              <button
                type="button"
                className="cycle-arrow-btn"
                onClick={() => {
                  if (floors.length === 0) return;
                  const idx = floors.findIndex((f) => f.id === selectedFloorId);
                  const nextIdx = idx <= 0 ? floors.length - 1 : idx - 1;
                  const newId = floors[nextIdx].id;
                  setSelectedFloorId(newId);
                  localStorage.setItem("selectedFloorId", String(newId));
                }}
                disabled={floors.length === 0}
                aria-label="Previous floor"
                title="Previous floor"
              >
                ◀
              </button>
              <select
                id="floor-select"
                className="room-select"
                value={selectedFloorId ?? ""}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  setSelectedFloorId(val);
                  if (val !== null) {
                    localStorage.setItem("selectedFloorId", String(val));
                  } else {
                    localStorage.removeItem("selectedFloorId");
                  }
                }}
              >
                {floors.length === 0 ? (
                  <option value="">No Floors</option>
                ) : (
                  floors.map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      {floor.name} (Level {floor.level})
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                className="cycle-arrow-btn"
                onClick={() => {
                  if (floors.length === 0) return;
                  const idx = floors.findIndex((f) => f.id === selectedFloorId);
                  const nextIdx = idx < 0 || idx >= floors.length - 1 ? 0 : idx + 1;
                  const newId = floors[nextIdx].id;
                  setSelectedFloorId(newId);
                  localStorage.setItem("selectedFloorId", String(newId));
                }}
                disabled={floors.length === 0}
                aria-label="Next floor"
                title="Next floor"
              >
                ▶
              </button>
              {selectedFloorId !== null && (
                <button
                  type="button"
                  className="delete-room-btn"
                  onClick={() => {
                    const floor = floors.find((f) => f.id === selectedFloorId);
                    if (floor && window.confirm(`Delete floor "${floor.name}"? This cannot be undone.`)) {
                      void deleteFloor(selectedFloorId);
                    }
                  }}
                  aria-label="Delete selected floor"
                  title="Delete floor"
                >
                  ✕
                </button>
              )}
              <button
                type="button"
                className="add-new-btn"
                onClick={() => {
                  const name = window.prompt("Floor name:");
                  if (!name) return;
                  const levelStr = window.prompt("Floor level (number):", "1");
                  if (levelStr === null) return;
                  const level = parseInt(levelStr, 10) || 1;
                  void createFloor(name, level);
                }}
                aria-label="Add new floor"
                title="Add floor"
                style={{ marginLeft: selectedFloorId !== null ? "4px" : undefined }}
              >
                +
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
