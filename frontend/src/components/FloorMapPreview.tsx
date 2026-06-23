"use client";

import { useCallback, useRef, useState } from "react";
import type { RoomMapResponse, RoomSummary } from "@/lib/types";
import { renderRoomSvgContent } from "@/lib/renderRoomSvg";

type Props = {
  rooms: RoomSummary[];
  selectedRoomIds: number[];
  unit: "m" | "ft";
  roomMapsById: Record<number, RoomMapResponse>;
  savedPositions?: Record<number, { x: number; y: number }>;
  onSavePositions?: (positions: Record<number, { x: number; y: number }>) => void;
};

type RoomLayout = {
  id: number;
  name: string;
  width_m: number;
  height_m: number;
  widthPx: number;
  heightPx: number;
  hasMapData: boolean;
};

type Position = { x: number; y: number };

const SNAP_THRESHOLD = 10;

export default function FloorMapPreview({ rooms, selectedRoomIds, unit, roomMapsById, savedPositions = {}, onSavePositions }: Props) {
  const FEET_PER_METER = 3.28084;
  const convert = (valueMeters: number) => (unit === "ft" ? valueMeters * FEET_PER_METER : valueMeters);
  const unitLabel = unit === "ft" ? "ft" : "m";

  const selectedRooms = selectedRoomIds
    .map((id) => rooms.find((room) => room.id === id))
    .filter((room): room is RoomSummary => Boolean(room));

  // Room positions: keyed by room id, values are {x, y} offsets
  const [roomPositions, setRoomPositions] = useState<Record<number, Position>>(savedPositions);

  // Drag state
  const [dragRoomId, setDragRoomId] = useState<number | null>(null);
  const dragStartRef = useRef<{ pointerId: number; startX: number; startY: number; roomStartX: number; roomStartY: number; scaleX: number; scaleY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const scale = 56;
  const gap = 12;
  const padding = 40;

  // Calculate room layout dimensions
  const roomRects: RoomLayout[] = selectedRooms.map((room) => {
    const mapData = roomMapsById[room.id];
    if (mapData) {
      const dims = renderRoomSvgContent({ mapData, unit, scale, includeRulers: false, includeLabel: false });
      return { ...room, widthPx: dims.svgWidth, heightPx: dims.svgHeight, hasMapData: true };
    }
    return {
      ...room,
      widthPx: Math.max(60, room.width_m * scale),
      heightPx: Math.max(60, room.height_m * scale),
      hasMapData: false,
    };
  });

  // Calculate default positions (side-by-side, vertically centered)
  const defaultPositions: Record<number, Position> = {};
  {
    let cursorX = padding;
    const maxRoomHeightPx = roomRects.reduce((max, room) => Math.max(max, room.heightPx), 0);
    for (const room of roomRects) {
      const y = padding + (maxRoomHeightPx - room.heightPx) / 2;
      defaultPositions[room.id] = { x: cursorX, y };
      cursorX += room.widthPx + gap;
    }
  }

  // Merge default positions with user-set positions
  const positions: Record<number, Position> = {};
  for (const room of roomRects) {
    positions[room.id] = roomPositions[room.id] ?? defaultPositions[room.id] ?? { x: padding, y: padding };
  }

  // Calculate SVG bounding box from current positions
  const svgWidth = Math.max(
    ...roomRects.map((room) => positions[room.id].x + room.widthPx),
    padding * 2
  ) + padding;
  const svgHeight = Math.max(
    ...roomRects.map((room) => positions[room.id].y + room.heightPx),
    padding * 2
  ) + padding;

  // Snap logic: find the best snap position for adjacency
  const snapPosition = useCallback(
    (roomId: number, rawX: number, rawY: number): Position => {
      const currentRoom = roomRects.find((r) => r.id === roomId);
      if (!currentRoom) return { x: rawX, y: rawY };

      let bestX = rawX;
      let bestY = rawY;
      let bestDist = SNAP_THRESHOLD; // Only snap if within threshold

      for (const other of roomRects) {
        if (other.id === roomId) continue;

        const otherPos = positions[other.id];
        const otherRight = otherPos.x + other.widthPx;
        const otherBottom = otherPos.y + other.heightPx;

        // Snap current room's left edge to other's right edge (current is right of other)
        {
          const snapX = otherRight;
          const dist = Math.abs(rawX - snapX);
          if (dist < bestDist) {
            const overlapTop = Math.max(rawY, otherPos.y);
            const overlapBottom = Math.min(rawY + currentRoom.heightPx, otherBottom);
            if (overlapBottom - overlapTop > 0) {
              bestX = snapX;
              bestY = rawY;
              bestDist = dist;
            }
          }
        }

        // Snap current room's right edge to other's left edge (current is left of other)
        {
          const snapX = otherPos.x - currentRoom.widthPx;
          const dist = Math.abs(rawX - snapX);
          if (dist < bestDist) {
            const overlapTop = Math.max(rawY, otherPos.y);
            const overlapBottom = Math.min(rawY + currentRoom.heightPx, otherBottom);
            if (overlapBottom - overlapTop > 0) {
              bestX = snapX;
              bestY = rawY;
              bestDist = dist;
            }
          }
        }

        // Snap current room's top edge to other's bottom edge (current is below other)
        {
          const snapY = otherBottom;
          const dist = Math.abs(rawY - snapY);
          if (dist < bestDist) {
            const overlapLeft = Math.max(rawX, otherPos.x);
            const overlapRight = Math.min(rawX + currentRoom.widthPx, otherRight);
            if (overlapRight - overlapLeft > 0) {
              bestX = rawX;
              bestY = snapY;
              bestDist = dist;
            }
          }
        }

        // Snap current room's bottom edge to other's top edge (current is above other)
        {
          const snapY = otherPos.y - currentRoom.heightPx;
          const dist = Math.abs(rawY - snapY);
          if (dist < bestDist) {
            const overlapLeft = Math.max(rawX, otherPos.x);
            const overlapRight = Math.min(rawX + currentRoom.widthPx, otherRight);
            if (overlapRight - overlapLeft > 0) {
              bestX = rawX;
              bestY = snapY;
              bestDist = dist;
            }
          }
        }

        // Align edges: snap current room's top to other's top
        {
          const dist = Math.abs(rawY - otherPos.y);
          if (dist < bestDist) {
            bestX = rawX;
            bestY = otherPos.y;
            bestDist = dist;
          }
        }

        // Align edges: snap current room's bottom to other's bottom
        {
          const currentBottom = rawY + currentRoom.heightPx;
          const otherBottom2 = otherPos.y + other.heightPx;
          const dist = Math.abs(currentBottom - otherBottom2);
          if (dist < bestDist) {
            bestX = rawX;
            bestY = otherBottom2 - currentRoom.heightPx;
            bestDist = dist;
          }
        }

        // Align edges: snap current room's left to other's left
        {
          const dist = Math.abs(rawX - otherPos.x);
          if (dist < bestDist) {
            bestX = otherPos.x;
            bestY = rawY;
            bestDist = dist;
          }
        }

        // Align edges: snap current room's right to other's right
        {
          const currentRight = rawX + currentRoom.widthPx;
          const otherRight2 = otherPos.x + other.widthPx;
          const dist = Math.abs(currentRight - otherRight2);
          if (dist < bestDist) {
            bestX = otherRight2 - currentRoom.widthPx;
            bestY = rawY;
            bestDist = dist;
          }
        }
      }

      return { x: bestX, y: bestY };
    },
    [roomRects, positions]
  );

  const handlePointerDown = useCallback(
    (roomId: number, e: React.PointerEvent<SVGGElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const pos = positions[roomId];
      // Capture the SVG scale at drag start so the coordinate mapping stays stable
      const svg = svgRef.current;
      const rect = svg?.getBoundingClientRect();
      const viewBox = svg?.viewBox.baseVal;
      const scaleX = viewBox && rect && rect.width > 0 ? viewBox.width / rect.width : 1;
      const scaleY = viewBox && rect && rect.height > 0 ? viewBox.height / rect.height : 1;
      dragStartRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        roomStartX: pos.x,
        roomStartY: pos.y,
        scaleX,
        scaleY,
      };
      setDragRoomId(roomId);
      (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    },
    [positions]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragRoomId === null || !dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.startX;
      const dy = e.clientY - dragStartRef.current.startY;

      // Use the scale factors captured at drag start to avoid resizing feedback
      const rawX = dragStartRef.current.roomStartX + dx * dragStartRef.current.scaleX;
      const rawY = dragStartRef.current.roomStartY + dy * dragStartRef.current.scaleY;

      const snapped = snapPosition(dragRoomId, rawX, rawY);

      setRoomPositions((prev) => ({
        ...prev,
        [dragRoomId]: snapped,
      }));
    },
    [dragRoomId, snapPosition]
  );

  const handlePointerUp = useCallback(() => {
    if (dragRoomId === null) return;
    dragStartRef.current = null;
    setDragRoomId(null);
    // Persist positions after drag completes
    onSavePositions?.(roomPositions);
  }, [dragRoomId, onSavePositions, roomPositions]);

  const handleDownloadSvg = useCallback(() => {
    const roomsData = selectedRooms
      .map((room) => roomMapsById[room.id])
      .filter((data): data is RoomMapResponse => Boolean(data));

    if (roomsData.length === 0) return;

    // Use current positions for the download
    const roomLayoutData = roomsData.map((mapData) => {
      const roomRect = roomRects.find((r) => r.id === mapData.room.id);
      const pos = positions[mapData.room.id];
      return { mapData, x: pos.x, y: pos.y, widthPx: roomRect?.widthPx ?? 0, heightPx: roomRect?.heightPx ?? 0 };
    });

    // Generate composite SVG with current positions
    const compositeWidth = Math.max(...roomLayoutData.map((r) => r.x + r.widthPx)) + padding;
    const compositeHeight = Math.max(...roomLayoutData.map((r) => r.y + r.heightPx)) + padding;

    const svgParts: string[] = [];
    for (const roomData of roomLayoutData) {
      const { content } = renderRoomSvgContent({
        mapData: roomData.mapData,
        unit,
        scale,
        offsetX: roomData.x,
        offsetY: roomData.y,
        includeRulers: false,
        includeLabel: true,
      });
      svgParts.push(content);
    }

    const svgString = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${compositeWidth}" height="${compositeHeight}" viewBox="0 0 ${compositeWidth} ${compositeHeight}" role="img" aria-label="Floor map">`,
      ...svgParts,
      `</svg>`,
    ].join("\n");

    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = blobUrl;
    downloadLink.download = `floor-map-layout.svg`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(blobUrl);
  }, [selectedRooms, roomMapsById, roomRects, positions, unit]);

  if (selectedRooms.length === 0) {
    return <p>Select one or more rooms from the Rooms table to render a floor map.</p>;
  }

  const allHaveMapData = roomRects.every((r) => r.hasMapData);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <h2 style={{ marginTop: 0, marginBottom: 0 }}>Floor Map</h2>
        {allHaveMapData && (
          <button
            type="button"
            onClick={handleDownloadSvg}
            style={{ border: 0, borderRadius: 8, background: "#dde8e4", color: "#1b2a2f", padding: "0.45rem 0.7rem", cursor: "pointer", font: "inherit" }}
          >
            Download SVG
          </button>
        )}
      </div>
      <p style={{ marginTop: 8, marginBottom: 10, opacity: 0.8, fontSize: "0.92rem" }}>
        Drag rooms to reposition. Rooms snap to adjacent borders.
      </p>
      <div style={{ position: "relative" }}>
        <svg
          ref={svgRef}
          width="100%"
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          role="img"
          aria-label="Floor map preview"
          style={{ touchAction: "none" }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {roomRects.map((room) => {
            const pos = positions[room.id];
            const mapData = roomMapsById[room.id];
            const isDragging = dragRoomId === room.id;

            if (mapData && room.hasMapData) {
              const { content } = renderRoomSvgContent({
                mapData,
                unit,
                scale,
                offsetX: pos.x,
                offsetY: pos.y,
                includeRulers: false,
                includeLabel: true,
              });
              return (
                <g
                  key={room.id}
                  dangerouslySetInnerHTML={{ __html: content }}
                  style={{ cursor: isDragging ? "grabbing" : "grab" }}
                  onPointerDown={(e) => handlePointerDown(room.id, e)}
                />
              );
            }

            // Fallback: simple rectangle
            return (
              <g
                key={room.id}
                style={{ cursor: isDragging ? "grabbing" : "grab" }}
                onPointerDown={(e) => handlePointerDown(room.id, e)}
              >
                <rect
                  x={pos.x}
                  y={pos.y}
                  width={room.widthPx}
                  height={room.heightPx}
                  rx={10}
                  fill="#fff"
                  stroke={isDragging ? "#f26b47" : "#1b2a2f"}
                  strokeWidth={isDragging ? 3 : 2}
                />
                <text x={pos.x + room.widthPx / 2} y={pos.y + 18} textAnchor="middle" fontSize={12} fill="#1b2a2f" fontWeight={700}>
                  {room.name}
                </text>
                <text x={pos.x + room.widthPx / 2} y={pos.y + room.heightPx - 8} textAnchor="middle" fontSize={10} fill="#4d5b60">
                  {convert(room.width_m).toFixed(1)} x {convert(room.height_m).toFixed(1)} {unitLabel}
                </text>
              </g>
            );
          })}
        </svg>
        <svg
          width="100%"
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
          aria-hidden="true"
        >
          {(() => {
            // Calculate bounding box of all rooms
            const xs = roomRects.map((r) => positions[r.id].x);
            const ys = roomRects.map((r) => positions[r.id].y);
            const rights = roomRects.map((r) => positions[r.id].x + r.widthPx);
            const bottoms = roomRects.map((r) => positions[r.id].y + r.heightPx);
            const boxLeft = Math.min(...xs);
            const boxTop = Math.min(...ys);
            const boxRight = Math.max(...rights);
            const boxBottom = Math.max(...bottoms);
            const boxWidth = boxRight - boxLeft;
            const boxHeight = boxBottom - boxTop;

            const xAxisY = boxTop - 10;
            const yAxisX = boxLeft - 5;
            const tickFractions = [0, 0.25, 0.5, 0.75, 1];

            return (
              <>
                {/* X-axis ruler */}
                <line x1={boxLeft} y1={xAxisY} x2={boxRight} y2={xAxisY} stroke="#6b7a7f" strokeWidth="1.5" />
                {tickFractions.map((fraction) => {
                  const x = boxLeft + fraction * boxWidth;
                  return (
                    <g key={`x-${fraction}`}>
                      <line x1={x} y1={xAxisY} x2={x} y2={xAxisY - 5} stroke="#6b7a7f" strokeWidth="1" />
                      <text x={x} y={xAxisY - 8} fontSize="10" fill="#4d5b60" textAnchor="middle">
                        {convert(boxWidth / scale * fraction).toFixed(1)}
                      </text>
                    </g>
                  );
                })}
                {/* Y-axis ruler */}
                <line x1={yAxisX} y1={boxTop} x2={yAxisX} y2={boxBottom} stroke="#6b7a7f" strokeWidth="1.5" />
                {tickFractions.map((fraction) => {
                  const y = boxTop + fraction * boxHeight;
                  return (
                    <g key={`y-${fraction}`}>
                      <line x1={yAxisX} y1={y} x2={yAxisX - 2.5} y2={y} stroke="#6b7a7f" strokeWidth="1" />
                      <text x={yAxisX - 5} y={y + 3} fontSize="8" fill="#4d5b60" textAnchor="end">
                        {convert(boxHeight / scale * fraction).toFixed(1)}
                      </text>
                    </g>
                  );
                })}
              </>
            );
          })()}
        </svg>
      </div>
    </div>
  );
}