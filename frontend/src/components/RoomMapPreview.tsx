"use client";

import React, { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { RoomMapResponse } from "@/lib/types";

type Props = {
  mapData: RoomMapResponse | null;
  unit: "m" | "ft";
  hiddenLabelIds: Set<number>;
  onToggleLabelVisibility: (id: number) => void;
  onMovePlacement?: (placementId: number, x_m: number, y_m: number) => Promise<boolean>;
  onResizePlacement?: (placementId: number, size_m: number) => Promise<boolean>;
  onDeletePlacement?: (placementId: number) => Promise<boolean>;
  onUpdatePlacementType?: (placementId: number, deviceType: string | null) => Promise<boolean>;
  onMoveFixture?: (elementId: number, x_m: number, y_m: number) => Promise<boolean>;
  onDeleteFixture?: (elementId: number) => Promise<boolean>;
  onResizeFixture?: (
    elementId: number,
    patch: {
      length_m: number;
      x_m?: number;
      y_m?: number;
      thickness_m?: number;
      rotation_degrees?: number;
    },
  ) => Promise<boolean>;
  onUpdateFixture?: (
    elementId: number,
    patch: {
      kind?: "wall" | "door" | "window" | "stairs" | "void" | "desk" | "sofa" | "entry" | "sink" | "fixture";
      rotation_degrees?: number;
    },
  ) => Promise<boolean>;
  onDropDevice?: (device: { entity_id: string; name: string }, x_m: number, y_m: number) => Promise<boolean>;
  onResizeRoom?: (width_m: number, height_m: number) => Promise<boolean>;
  onSetUnit?: (unit: "m" | "ft") => void;
  onInsertFixture?: () => void;
  onAssignDevices?: () => void;
  onRemoveAllDevices?: () => void;
  onRemoveAllFixtures?: () => void;
};

export default function RoomMapPreview({
  mapData,
  unit,
  hiddenLabelIds,
  onToggleLabelVisibility,
  onMovePlacement,
  onResizePlacement,
  onDeletePlacement,
  onUpdatePlacementType,
  onMoveFixture,
  onDeleteFixture,
  onResizeFixture,
  onUpdateFixture,
  onDropDevice,
  onResizeRoom,
  onSetUnit,
  onInsertFixture,
  onAssignDevices,
  onRemoveAllDevices,
  onRemoveAllFixtures,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const elementDragMovedRef = useRef(false);
  const pendingPlacementPressRef = useRef<{
    placementId: number;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const pendingElementPressRef = useRef<{
    elementId: number;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const pendingResizePressRef = useRef<{
    elementId: number;
    pointerId: number;
    startX: number;
    startY: number;
    startLengthM: number;
    startThicknessM: number;
    startElementX_m: number;
    startElementY_m: number;
    rotation_degrees: number;
    // Anchor corner screen position (the corner that stays fixed during resize)
    anchorScreenX: number;
    anchorScreenY: number;
  } | null>(null);
  const pendingResizePlacementPressRef = useRef<{
    placementId: number;
    pointerId: number;
    startX: number;
    startY: number;
    startSizeM: number;
    centerX: number;
    centerY: number;
  } | null>(null);
  const FEET_PER_METER = 3.28084;
  const unitLabel = unit === "ft" ? "ft" : "m";
  const convert = (valueMeters: number) => (unit === "ft" ? valueMeters * FEET_PER_METER : valueMeters);

  const plotWidth = 360;
  const plotHeight = Math.max(240, ((mapData?.room.height_m ?? 1) / (mapData?.room.width_m ?? 1)) * plotWidth);
  const ruler = { left: 28, top: 50, right: 24, bottom: 24 };
  const svgWidth = plotWidth + ruler.left + ruler.right;
  const svgHeight = plotHeight + ruler.top + ruler.bottom;
  const plotX = ruler.left;
  const plotY = ruler.top;
  const xAxisY = plotY - 8;
  const yAxisX = plotX - 8;
  const tickFractions = [0, 0.25, 0.5, 0.75, 1];

  const [placements, setPlacements] = useState(mapData?.placements ?? []);
  const [fixtures, setFixtures] = useState(mapData?.fixtures ?? []);
  const [dragPlacementId, setDragPlacementId] = useState<number | null>(null);
  const [dragElementId, setDragElementId] = useState<number | null>(null);
  const [resizeElementId, setResizeElementId] = useState<number | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<number | null>(null);
  const [selectedPlacementId, setSelectedPlacementId] = useState<number | null>(null);
  const [resizePlacementId, setResizePlacementId] = useState<number | null>(null);
  const [pendingSavePlacementId, setPendingSavePlacementId] = useState<number | null>(null);
  const [pendingSaveElementId, setPendingSaveElementId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const fixtureKinds = ["wall", "door", "window", "stairs", "void", "desk", "sofa", "entry", "sink", "fixture"] as const;

  useEffect(() => {
    if (!mapData) return;
    setPlacements(mapData!.placements);
  }, [mapData]);

  useEffect(() => {
    setFixtures(mapData?.fixtures ?? []);
  }, [mapData?.fixtures]);

  useEffect(() => {
    setSelectedElementId((prev) => {
      if (prev === null) return null;
      return (mapData?.fixtures ?? []).some((element) => element.id === prev) ? prev : null;
    });
  }, [mapData?.fixtures]);

  useEffect(() => {
    setSelectedPlacementId((prev) => {
      if (prev === null) return null;
      return (mapData?.placements ?? []).some((p) => p.id === prev) ? prev : null;
    });
  }, [mapData?.placements]);

  const placementsById = useMemo(() => {
    const byId = new Map<number, (typeof placements)[number]>();
    for (const placement of placements) {
      byId.set(placement.id, placement);
    }
    return byId;
  }, [placements]);

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const pointerToRoomPosition = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const svgX = ((clientX - rect.left) / rect.width) * svgWidth;
    const svgY = ((clientY - rect.top) / rect.height) * svgHeight;
    const dryOuterX = plotX - 5;
    const dryOuterY = plotY - 5;
    const dryOuterW = plotWidth + 10;
    const dryOuterH = plotHeight + 10;
    const inBounds = svgX >= dryOuterX && svgX <= dryOuterX + dryOuterW && svgY >= dryOuterY && svgY <= dryOuterY + dryOuterH;
    const clampedX = clamp(svgX, dryOuterX, dryOuterX + dryOuterW);
    const clampedY = clamp(svgY, dryOuterY, dryOuterY + dryOuterH);
    const x_m = ((clampedX - plotX) / plotWidth) * mapData!.room.width_m;
    const y_m = ((clampedY - plotY) / plotHeight) * mapData!.room.height_m;
    return {
      inBounds,
      x_m: Number(x_m.toFixed(3)),
      y_m: Number(y_m.toFixed(3)),
    };
  };

  const handleDragMove = (pointerId: number, clientX: number, clientY: number) => {
    if (dragPlacementId === null && pendingPlacementPressRef.current?.pointerId === pointerId) {
      const pending = pendingPlacementPressRef.current;
      const dx = clientX - pending.startX;
      const dy = clientY - pending.startY;
      const dragStartThresholdPx = 6;
      if (Math.hypot(dx, dy) >= dragStartThresholdPx) {
        setDragPlacementId(pending.placementId);
        const svg = svgRef.current;
        if (svg) {
          svg.setPointerCapture(pointerId);
        }
      }
    }

    if (dragElementId === null && pendingElementPressRef.current?.pointerId === pointerId) {
      const pending = pendingElementPressRef.current;
      const dx = clientX - pending.startX;
      const dy = clientY - pending.startY;
      const dragStartThresholdPx = 6;
      if (Math.hypot(dx, dy) >= dragStartThresholdPx) {
        setDragElementId(pending.elementId);
        const svg = svgRef.current;
        if (svg) {
          svg.setPointerCapture(pointerId);
        }
      }
    }

    if (resizeElementId === null && pendingResizePressRef.current?.pointerId === pointerId) {
      const pending = pendingResizePressRef.current;
      const dx = clientX - pending.startX;
      const dy = clientY - pending.startY;
      const dragStartThresholdPx = 6;
      if (Math.hypot(dx, dy) >= dragStartThresholdPx) {
        setResizeElementId(pending.elementId);
        const svg = svgRef.current;
        if (svg) {
          svg.setPointerCapture(pointerId);
        }
      }
    }

    if (resizePlacementId === null && pendingResizePlacementPressRef.current?.pointerId === pointerId) {
      const pending = pendingResizePlacementPressRef.current;
      const dx = clientX - pending.startX;
      const dy = clientY - pending.startY;
      const dragStartThresholdPx = 6;
      if (Math.hypot(dx, dy) >= dragStartThresholdPx) {
        setResizePlacementId(pending.placementId);
        const svg = svgRef.current;
        if (svg) {
          svg.setPointerCapture(pointerId);
        }
      }
    }

    if (dragPlacementId === null && dragElementId === null && resizeElementId === null && resizePlacementId === null) return;
    const nextPosition = pointerToRoomPosition(clientX, clientY);
    if (!nextPosition) return;

    if (dragPlacementId !== null) {
      setPlacements((prev) =>
        prev.map((placement) =>
          placement.id === dragPlacementId
            ? { ...placement, x_m: nextPosition.x_m, y_m: nextPosition.y_m }
            : placement,
        ),
      );
    }

    if (dragElementId !== null) {
      elementDragMovedRef.current = true;
      setFixtures((prev) =>
        prev.map((element) =>
          element.id === dragElementId
            ? { ...element, x_m: nextPosition.x_m, y_m: nextPosition.y_m }
            : element,
        ),
      );
    }

    if (resizeElementId !== null && pendingResizePressRef.current?.pointerId === pointerId) {
      const pending = pendingResizePressRef.current;
      const dx = clientX - pending.startX;
      const dy = clientY - pending.startY;
      const angleRad = (pending.rotation_degrees * Math.PI) / 180;
      const cosA = Math.cos(angleRad);
      const sinA = Math.sin(angleRad);
      // Project screen delta onto the element's local axes
      // length axis is along rotation_degrees from horizontal
      // thickness axis is perpendicular (rotation_degrees + 90)
      const localDx = dx * cosA + dy * sinA;   // along length axis in pixels
      const localDy = -dx * sinA + dy * cosA;   // along thickness axis in pixels
      const scaleLengthPx = Math.max(1, plotWidth / mapData!.room.width_m);
      const scaleThicknessPx = Math.max(1, plotHeight / mapData!.room.height_m);
      // Corner resize: both dimensions change simultaneously
      const deltaLengthM = localDx / scaleLengthPx;
      const deltaThicknessM = localDy / scaleThicknessPx;
      const nextLength = Math.max(0.2, pending.startLengthM + deltaLengthM);
      const nextThickness = Math.max(0.08, pending.startThicknessM + deltaThicknessM);
      // The anchor corner (top-left in local coords) stays fixed on screen.
      // Compute the new center so that the anchor corner position is preserved.
      // Anchor corner relative to center in local coords: (-startLengthPx/2, -startThicknessPx/2)
      // After resize, new center = anchor + (newLengthPx/2, newThicknessPx/2) rotated back to world
      const newLengthPx = nextLength * scaleLengthPx;
      const newThicknessPx = nextThickness * scaleThicknessPx;
      // Center offset from anchor in local coords: (newLength/2, newThickness/2)
      // Rotate to screen coords: (lx*cos - ly*sin, lx*sin + ly*cos)
      const centerOffsetScreenX = (newLengthPx / 2) * cosA - (newThicknessPx / 2) * sinA;
      const centerOffsetScreenY = (newLengthPx / 2) * sinA + (newThicknessPx / 2) * cosA;
      const newCenterScreenX = pending.anchorScreenX + centerOffsetScreenX;
      const newCenterScreenY = pending.anchorScreenY + centerOffsetScreenY;
      // Convert screen center position back to room meters
      const nextX_m = Number(((newCenterScreenX - plotX) / plotWidth * mapData!.room.width_m).toFixed(3));
      const nextY_m = Number(((newCenterScreenY - plotY) / plotHeight * mapData!.room.height_m).toFixed(3));
      setFixtures((prev) =>
        prev.map((element) =>
          element.id === resizeElementId
            ? {
                ...element,
                length_m: Number(nextLength.toFixed(3)),
                thickness_m: Number(nextThickness.toFixed(3)),
                x_m: nextX_m,
                y_m: nextY_m,
                rotation_degrees: pending.rotation_degrees,
              }
            : element,
        ),
      );
    }

    if (resizePlacementId !== null && pendingResizePlacementPressRef.current?.pointerId === pointerId) {
      const pending = pendingResizePlacementPressRef.current;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      // Convert current pointer to SVG coords
      const svgX = ((clientX - rect.left) / rect.width) * svgWidth;
      const svgY = ((clientY - rect.top) / rect.height) * svgHeight;
      // Distance from device center in SVG pixels
      const distPx = Math.hypot(svgX - pending.centerX, svgY - pending.centerY);
      // Convert pixels to meters (use width scale)
      const scalePx = Math.max(1, plotWidth / mapData!.room.width_m);
      // distPx is the radius in pixels; size_m is diameter, so multiply by 2
      const nextSize = Math.max(0.05, Number((2 * distPx / scalePx).toFixed(3)));
      setPlacements((prev) =>
        prev.map((p) =>
          p.id === resizePlacementId ? { ...p, size_m: nextSize } : p,
        ),
      );
    }
  };

  const handleDragEnd = async (pointerId: number, clientX: number, clientY: number) => {
    const placementId = dragPlacementId;
    const elementId = dragElementId;
    const resizingId = resizeElementId;
    const resizingPlacementId = resizePlacementId;
    const svg = svgRef.current;
    if (svg && svg.hasPointerCapture(pointerId)) {
      svg.releasePointerCapture(pointerId);
    }
    setDragPlacementId(null);
    setDragElementId(null);
    setResizeElementId(null);
    setResizePlacementId(null);
    pendingPlacementPressRef.current = null;
    pendingElementPressRef.current = null;
    const resizePending = pendingResizePressRef.current;
    pendingResizePressRef.current = null;
    const resizePlacementPending = pendingResizePlacementPressRef.current;
    pendingResizePlacementPressRef.current = null;

    if (placementId === null && elementId === null && resizingId === null && resizingPlacementId === null) return;
    const releasedPosition = pointerToRoomPosition(clientX, clientY);
    if (!releasedPosition) return;

    if (placementId !== null) {
      if (!releasedPosition.inBounds && onDeletePlacement) {
        const ok = await onDeletePlacement(placementId);
        if (!ok) {
          setPlacements(mapData!.placements);
        }
        return;
      }

      if (!onMovePlacement) return;
      const moved = placementsById.get(placementId);
      if (!moved) return;

      setPendingSavePlacementId(placementId);
      const ok = await onMovePlacement(placementId, moved.x_m, moved.y_m);
      setPendingSavePlacementId((current) => (current === placementId ? null : current));
      if (!ok) {
        setPlacements(mapData!.placements);
      }
      return;
    }

    if (elementId !== null) {
      if (!elementDragMovedRef.current) {
        return;
      }
      if (!releasedPosition.inBounds && onDeleteFixture) {
        const ok = await onDeleteFixture(elementId);
        if (!ok) {
          setFixtures(mapData!.fixtures ?? []);
        }
        return;
      }

      if (!onMoveFixture) return;
      const movedElement = fixtures.find((element) => element.id === elementId);
      if (!movedElement) return;
      setPendingSaveElementId(elementId);
      const ok = await onMoveFixture(elementId, movedElement.x_m, movedElement.y_m);
      setPendingSaveElementId((current) => (current === elementId ? null : current));
      if (!ok) {
        setFixtures(mapData!.fixtures ?? []);
      }
      return;
    }

    if (resizingId !== null && resizePending?.elementId === resizingId) {
      const movedElement = fixtures.find((element) => element.id === resizingId);
      if (!movedElement || !onResizeFixture) return;
      setPendingSaveElementId(resizingId);
      const ok = await onResizeFixture(resizingId, {
        length_m: movedElement.length_m,
        thickness_m: movedElement.thickness_m,
        x_m: movedElement.x_m,
        y_m: movedElement.y_m,
        rotation_degrees: movedElement.rotation_degrees,
      });
      setPendingSaveElementId((current) => (current === resizingId ? null : current));
      if (!ok) {
        setFixtures(mapData!.fixtures ?? []);
      }
      return;
    }

    if (resizingPlacementId !== null && resizePlacementPending?.placementId === resizingPlacementId) {
      const movedPlacement = placements.find((p) => p.id === resizingPlacementId);
      if (!movedPlacement || !onResizePlacement) return;
      setPendingSavePlacementId(resizingPlacementId);
      const ok = await onResizePlacement(resizingPlacementId, movedPlacement.size_m ?? 0.1);
      setPendingSavePlacementId((current) => (current === resizingPlacementId ? null : current));
      if (!ok) {
        setPlacements(mapData!.placements);
      }
    }
  };

  const handleDownloadSvg = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const exportSvg = svg.cloneNode(true) as SVGSVGElement;
    exportSvg.querySelectorAll('[data-export-exclude="true"]').forEach((node) => node.remove());
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(exportSvg);
    if (!source.includes("xmlns=\"http://www.w3.org/2000/svg\"")) {
      source = source.replace("<svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"");
    }
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const safeRoomName = mapData!.room.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const downloadLink = document.createElement("a");
    downloadLink.href = blobUrl;
    downloadLink.download = `${safeRoomName || "room"}-map.svg`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(blobUrl);
  };

  const handleDropDevice = async (event: DragEvent<SVGSVGElement>) => {
    if (!onDropDevice) return;
    const raw = event.dataTransfer.getData("application/x-ha-device");
    if (!raw) return;

    let parsed: { entity_id?: string; name?: string } = {};
    try {
      parsed = JSON.parse(raw) as { entity_id?: string; name?: string };
    } catch {
      return;
    }

    if (!parsed.entity_id || !parsed.name) return;
    const nextPosition = pointerToRoomPosition(event.clientX, event.clientY);
    if (!nextPosition) return;
    await onDropDevice({ entity_id: parsed.entity_id, name: parsed.name }, nextPosition.x_m, nextPosition.y_m);
  };

  const persistElementPatch = async (
    elementId: number,
    patch: {
      kind?: "wall" | "door" | "window" | "stairs" | "void" | "desk" | "sofa" | "entry" | "sink" | "fixture";
      rotation_degrees?: number;
    },
  ) => {
    if (!onUpdateFixture) return;
    setPendingSaveElementId(elementId);
    const ok = await onUpdateFixture(elementId, patch);
    setPendingSaveElementId((current) => (current === elementId ? null : current));
    if (!ok) {
      setFixtures(mapData!.fixtures ?? []);
    }
  };

  const handleCycleElementKind = (elementId: number) => {
    let nextKind: (typeof fixtureKinds)[number] | null = null;
    setFixtures((prev) =>
      prev.map((element) => {
        if (element.id !== elementId) return element;
        const idx = fixtureKinds.indexOf(element.kind);
        const resolved = fixtureKinds[(idx + 1) % fixtureKinds.length];
        nextKind = resolved;
        return { ...element, kind: resolved };
      }),
    );
    if (nextKind) {
      void persistElementPatch(elementId, { kind: nextKind });
    }
  };

  const handleRotateElement = (elementId: number) => {
    let nextRotation: number | null = null;
    setFixtures((prev) =>
      prev.map((element) => {
        if (element.id !== elementId) return element;
        const resolved = (element.rotation_degrees + 90) % 360;
        nextRotation = resolved;
        return { ...element, rotation_degrees: resolved };
      }),
    );
    if (nextRotation !== null) {
      void persistElementPatch(elementId, { rotation_degrees: nextRotation });
    }
  };

  const selectedElementData = selectedElementId !== null
    ? fixtures.find((el) => el.id === selectedElementId) ?? null
    : null;

  const selectedPlacementData = selectedPlacementId !== null
    ? placements.find((p) => p.id === selectedPlacementId) ?? null
    : null;

  // ─── Keyboard nudge support ──────────────────────────────────
  // Refs keep the latest state so the keydown listener stays stable.
  const keyboardStateRef = useRef({
    selectedElementId,
    selectedPlacementId,
    fixtures,
    placements,
  });
  keyboardStateRef.current = { selectedElementId, selectedPlacementId, fixtures, placements };

  const saveFixtureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePlacementTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
    const STEP_M = 0.1;       // ~10 cm per press
    const LARGE_STEP_M = 0.5;  // shift+arrow for bigger jumps

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in form fields
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;

      // Escape deselects
      if (e.key === "Escape") {
        if (keyboardStateRef.current.selectedElementId !== null) setSelectedElementId(null);
        if (keyboardStateRef.current.selectedPlacementId !== null) setSelectedPlacementId(null);
        return;
      }

      if (!ARROW_KEYS.has(e.key)) return;

      const { selectedElementId: selFixture, selectedPlacementId: selPlacement, fixtures: currFixtures, placements: currPlacements } = keyboardStateRef.current;
      if (selFixture === null && selPlacement === null) return;
      if (!mapData) return;

      e.preventDefault();

      const step = e.shiftKey ? LARGE_STEP_M : STEP_M;
      const deltaX = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const deltaY = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;

      if (selFixture !== null) {
        const fixture = currFixtures.find((f) => f.id === selFixture);
        if (!fixture) return;
        const newX = Math.max(0, Math.min(mapData!.room.width_m, fixture.x_m + deltaX));
        const newY = Math.max(0, Math.min(mapData!.room.height_m, fixture.y_m + deltaY));
        setFixtures((prev) =>
          prev.map((f) => (f.id === selFixture ? { ...f, x_m: newX, y_m: newY } : f)),
        );
        if (saveFixtureTimeoutRef.current) clearTimeout(saveFixtureTimeoutRef.current);
        saveFixtureTimeoutRef.current = setTimeout(async () => {
          if (!onMoveFixture) return;
          setPendingSaveElementId(selFixture);
          const ok = await onMoveFixture(selFixture, newX, newY);
          setPendingSaveElementId((current) => (current === selFixture ? null : current));
          if (!ok) setFixtures(mapData!.fixtures ?? []);
        }, 400);
      }

      if (selPlacement !== null && mapData) {
        const placement = currPlacements.find((p) => p.id === selPlacement);
        if (!placement) return;
        const newX = Math.max(0, Math.min(mapData!.room.width_m, placement.x_m + deltaX));
        const newY = Math.max(0, Math.min(mapData!.room.height_m, placement.y_m + deltaY));
        setPlacements((prev) =>
          prev.map((p) => (p.id === selPlacement ? { ...p, x_m: newX, y_m: newY } : p)),
        );
        if (savePlacementTimeoutRef.current) clearTimeout(savePlacementTimeoutRef.current);
        savePlacementTimeoutRef.current = setTimeout(async () => {
          if (!onMovePlacement) return;
          setPendingSavePlacementId(selPlacement);
          const ok = await onMovePlacement(selPlacement, newX, newY);
          setPendingSavePlacementId((current) => (current === selPlacement ? null : current));
          if (!ok) setPlacements(mapData!.placements);
        }, 400);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mapData, onMoveFixture, onMovePlacement]);

  if (!mapData) {
    return <p>No room map yet. Ask the chat to render one.</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <h2 style={{ marginTop: 0, marginBottom: 0 }}>{mapData.room.name} Map</h2>
        <button
          type="button"
          onClick={handleDownloadSvg}
          style={{ border: 0, borderRadius: 8, background: "#dde8e4", color: "#1b2a2f", padding: "0.45rem 0.7rem", cursor: "pointer", font: "inherit" }}
        >
          Download SVG
        </button>
      </div>
      <div style={{ position: "relative" }}>
        <svg
          ref={svgRef}
          width="100%"
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          role="img"
          aria-label="Room map preview with draggable placements"
          style={{ touchAction: "none", transform: `scale(${zoom})`, transformOrigin: "top left" }}
          onDragOver={(e) => {
            if (onDropDevice) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            void handleDropDevice(e);
          }}
          onPointerDown={(e) => {
            const target = e.target as SVGElement;
            if (target.tagName.toLowerCase() === "svg") {
              setSelectedElementId(null);
              setSelectedPlacementId(null);
            }
          }}
          onPointerMove={(e) => handleDragMove(e.pointerId, e.clientX, e.clientY)}
          onPointerUp={(e) => void handleDragEnd(e.pointerId, e.clientX, e.clientY)}
          onPointerCancel={(e) => void handleDragEnd(e.pointerId, e.clientX, e.clientY)}
        >
        <rect
          x={plotX}
          y={plotY}
          width={plotWidth}
          height={plotHeight}
          fill="#fff"
          stroke="#1b2a2f"
          strokeWidth="2"
          rx="12"
          onPointerDown={() => {
            setSelectedElementId(null);
            setSelectedPlacementId(null);
          }}
        />
        {/* Drywall border – thin double line outside the room dimensions */}
        <rect
          x={plotX - 1}
          y={plotY - 1}
          width={plotWidth + 2}
          height={plotHeight + 2}
          fill="none"
          stroke="#8d9aa0"
          strokeWidth={1}
          rx={13}
          pointerEvents="none"
        />
        <rect
          x={plotX - 5}
          y={plotY - 5}
          width={plotWidth + 10}
          height={plotHeight + 10}
          fill="none"
          stroke="#8d9aa0"
          strokeWidth={1}
          rx={17}
          pointerEvents="none"
        />
        {[...fixtures].sort((a, b) => {
          // Render entry fixtures last so they appear on top, obscuring overlaps
          if (a.kind === "entry" && b.kind !== "entry") return 1;
          if (a.kind !== "entry" && b.kind === "entry") return -1;
          return 0;
        }).map((element) => {
          const centerX = plotX + (element.x_m / mapData.room.width_m) * plotWidth;
          const centerY = plotY + (element.y_m / mapData.room.height_m) * plotHeight;
          const elementLengthPx = Math.max(12, (element.length_m / mapData.room.width_m) * plotWidth);
          const elementThicknessYPx = Math.max(6, (element.thickness_m / mapData.room.height_m) * plotHeight);
          // Always draw with length along X axis, then rotate
          const drawWidth = elementLengthPx;
          const drawHeight = elementThicknessYPx;
          const x = centerX - drawWidth / 2;
          const y = centerY - drawHeight / 2;
          const rotDeg = element.rotation_degrees;
          const isPending = pendingSaveElementId === element.id;
          const handleRadius = 4;
          // Single corner handle at bottom-right; anchor is top-left
          const rotRad = (rotDeg * Math.PI) / 180;
          const cosR = Math.cos(rotRad);
          const sinR = Math.sin(rotRad);
          // Bottom-right corner in local coords
          const localCornerX = x + drawWidth;
          const localCornerY = y + drawHeight;
          const cornerDx = localCornerX - centerX;
          const cornerDy = localCornerY - centerY;
          const handleX = centerX + cornerDx * cosR - cornerDy * sinR;
          const handleY = centerY + cornerDx * sinR + cornerDy * cosR;
          // Anchor (top-left) corner in screen coords
          const anchorLocalX = x;
          const anchorLocalY = y;
          const anchorDx = anchorLocalX - centerX;
          const anchorDy = anchorLocalY - centerY;
          const anchorScreenX = centerX + anchorDx * cosR - anchorDy * sinR;
          const anchorScreenY = centerY + anchorDx * sinR + anchorDy * cosR;
          const handles = [
            { key: "corner", x: handleX, y: handleY, anchorScreenX, anchorScreenY },
          ];

          const fill = "#000000";
          const renderAsParallelLines = element.kind === "wall";
          const renderAsDoorDiagonal = element.kind === "door";
          const renderAsWindow = element.kind === "window";
          const renderAsVoid = element.kind === "void";
          const renderAsDesk = element.kind === "desk";
          const renderAsSofa = element.kind === "sofa";
          const renderAsEntry = element.kind === "entry";
          const renderAsSink = element.kind === "sink";
          const renderAsFixture = element.kind === "fixture";
          const lineGap = Math.max(2, Math.min(6, Math.min(drawWidth, drawHeight) * 0.5));
          const lineStrokeWidth = 1.2;
          const windowStroke = "#000000";

          return (
            <React.Fragment key={`arch-${element.id}`}>
            <g transform={`rotate(${rotDeg}, ${centerX}, ${centerY})`}>
              <rect
                x={x}
                y={y}
                width={drawWidth}
                height={drawHeight}
                rx={2}
                fill={
                  renderAsParallelLines || renderAsDoorDiagonal || renderAsWindow || element.kind === "stairs" || renderAsVoid || renderAsDesk || renderAsSofa || renderAsEntry || renderAsSink || renderAsFixture
                    ? "transparent"
                    : fill
                }
                opacity={renderAsParallelLines ? 1 : isPending ? 0.75 : 0.95}
                stroke={isPending ? "#14532d" : "none"}
                strokeWidth={isPending ? 2 : 0}
                style={{ cursor: "pointer" }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedElementId(element.id);
                  setSelectedPlacementId(null);
                  elementDragMovedRef.current = false;
                  pendingElementPressRef.current = {
                    elementId: element.id,
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startY: e.clientY,
                  };
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCycleElementKind(element.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleRotateElement(element.id);
                }}
              />
              {renderAsParallelLines && (
                <g pointerEvents="none" opacity={isPending ? 0.75 : 0.95}>
                  <line
                    x1={x}
                    y1={centerY - lineGap}
                    x2={x + drawWidth}
                    y2={centerY - lineGap}
                    stroke={fill}
                    strokeWidth={lineStrokeWidth}
                  />
                  <line
                    x1={x}
                    y1={centerY + lineGap}
                    x2={x + drawWidth}
                    y2={centerY + lineGap}
                    stroke={fill}
                    strokeWidth={lineStrokeWidth}
                  />
                </g>
              )}
              {renderAsDoorDiagonal && (
                <g pointerEvents="none" opacity={isPending ? 0.75 : 0.95}>
                  <rect
                    x={x + drawWidth / 2 - 3}
                    y={y}
                    width={6}
                    height={Math.sqrt(drawWidth * drawWidth + drawHeight * drawHeight)}
                    transform={`rotate(30 ${x + drawWidth / 2} ${y + drawHeight / 2})`}
                    fill="none"
                    stroke="#000000"
                    strokeWidth={1.5}
                  />
                </g>
              )}
              {element.kind === "window" && (
                <g pointerEvents="none" opacity={isPending ? 0.75 : 0.95}>
                  <line
                    x1={x}
                    y1={centerY - lineGap}
                    x2={x + drawWidth}
                    y2={centerY - lineGap}
                    stroke={windowStroke}
                    strokeWidth={1.1}
                  />
                  <line
                    x1={x}
                    y1={centerY + lineGap}
                    x2={x + drawWidth}
                    y2={centerY + lineGap}
                    stroke={windowStroke}
                    strokeWidth={1.1}
                  />
                  <line
                    x1={centerX}
                    y1={centerY - lineGap - 1.5}
                    x2={centerX}
                    y2={centerY + lineGap + 1.5}
                    stroke={windowStroke}
                    strokeWidth={0.9}
                  />
                </g>
              )}
              {element.kind === "stairs" && (
                <g pointerEvents="none" opacity={isPending ? 0.75 : 1}>
                  <rect
                    x={x}
                    y={y}
                    width={drawWidth}
                    height={drawHeight}
                    rx={2}
                    fill="#e5e7eb"
                    fillOpacity={0.3}
                    stroke="none"
                  />
                  {[0.2, 0.4, 0.6, 0.8].map((step) => {
                    const stepX = x + drawWidth * step;
                    return <line key={`step-${step}`} x1={stepX} y1={y} x2={stepX} y2={y + drawHeight} stroke="#000000" strokeWidth={1} />;
                  })}
                </g>
              )}
              {renderAsVoid && (
                <g pointerEvents="none" opacity={isPending ? 0.75 : 1}>
                  <rect
                    x={x}
                    y={y}
                    width={drawWidth}
                    height={drawHeight}
                    fill="none"
                    stroke="#000000"
                    strokeWidth={1.2}
                  />
                  <line x1={x} y1={y} x2={x + drawWidth} y2={y + drawHeight} stroke="#000000" strokeWidth={1} />
                  <line x1={x + drawWidth} y1={y} x2={x} y2={y + drawHeight} stroke="#000000" strokeWidth={1} />
                </g>
              )}
              {renderAsDesk && (
                <g pointerEvents="none" opacity={isPending ? 0.75 : 1}>
                  <rect
                    x={x}
                    y={y}
                    width={drawWidth}
                    height={drawHeight}
                    rx={2}
                    fill="#8b6a4d"
                    fillOpacity={0.15}
                    stroke="#000000"
                    strokeWidth={1.2}
                  />
                  <line x1={x + drawWidth * 0.15} y1={centerY} x2={x + drawWidth * 0.85} y2={centerY} stroke="#000000" strokeWidth={1} />
                </g>
              )}
              {renderAsSofa && (
                <g pointerEvents="none" opacity={isPending ? 0.75 : 1}>
                  <rect
                    x={x}
                    y={y}
                    width={drawWidth}
                    height={drawHeight}
                    rx={Math.max(4, Math.min(drawWidth, drawHeight) * 0.25)}
                    fill="#94a3b8"
                    fillOpacity={0.15}
                    stroke="#000000"
                    strokeWidth={1.2}
                  />
                  <line
                    x1={x + drawWidth * 0.08}
                    y1={y + drawHeight * 0.28}
                    x2={x + drawWidth * 0.92}
                    y2={y + drawHeight * 0.28}
                    stroke="#000000"
                    strokeWidth={1}
                  />
                </g>
              )}
              {renderAsEntry && (
                <g pointerEvents="none" opacity={isPending ? 0.75 : 1}>
                  <rect
                    x={x}
                    y={y}
                    width={drawWidth}
                    height={drawHeight}
                    rx={2}
                    fill="#fff"
                    stroke="#000000"
                    strokeWidth={1.4}
                  />
                </g>
              )}
              {renderAsSink && (
                <g pointerEvents="none" opacity={isPending ? 0.75 : 1}>
                  {/* Outer basin outline */}
                  <rect
                    x={x}
                    y={y}
                    width={drawWidth}
                    height={drawHeight}
                    rx={Math.max(2, Math.min(drawWidth, drawHeight) * 0.15)}
                    fill="none"
                    stroke="#000000"
                    strokeWidth={1.4}
                  />
                  {/* Inner basin */}
                  {(() => {
                    const inset = Math.max(1.5, Math.min(drawWidth, drawHeight) * 0.08);
                    return (
                      <rect
                        x={x + inset}
                        y={y + inset}
                        width={drawWidth - 2 * inset}
                        height={drawHeight - 2 * inset}
                        rx={Math.max(1, Math.min(drawWidth, drawHeight) * 0.1)}
                        fill="none"
                        stroke="#000000"
                        strokeWidth={1}
                      />
                    );
                  })()}
                  {/* Faucet */}
                  {(() => {
                    const faucetW = Math.max(1.5, Math.min(drawWidth, drawHeight) * 0.06);
                    const faucetH = Math.max(4, drawHeight * 0.25);
                    return (
                      <rect
                        x={centerX - faucetW / 2}
                        y={y - faucetH}
                        width={faucetW}
                        height={faucetH}
                        fill="none"
                        stroke="#000000"
                        strokeWidth={1}
                      />
                    );
                  })()}
                  {/* Drain */}
                  <circle
                    cx={centerX}
                    cy={centerY}
                    r={Math.max(1, Math.min(drawWidth, drawHeight) * 0.06)}
                    fill="none"
                    stroke="#000000"
                    strokeWidth={1}
                  />
                </g>
              )}
              {renderAsFixture && (
                <g pointerEvents="none" opacity={isPending ? 0.75 : 1}>
                  <rect
                    x={x}
                    y={y}
                    width={drawWidth}
                    height={drawHeight}
                    rx={2}
                    fill="none"
                    stroke="#000000"
                    strokeWidth={1.4}
                  />
                  <line x1={x} y1={y} x2={x + drawWidth} y2={y + drawHeight} stroke="#000000" strokeWidth={0.8} />
                </g>
              )}
            </g>
            {selectedElementId === element.id && handles.map((handle) => (
              <rect
                key={`${element.id}-${handle.key}`}
                x={handle.x - handleRadius}
                y={handle.y - handleRadius}
                width={handleRadius * 2}
                height={handleRadius * 2}
                data-export-exclude="true"
                fill="#f8fafc"
                stroke="#0f172a"
                strokeWidth={1}
                style={{ cursor: "nwse-resize" }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  pendingResizePressRef.current = {
                    elementId: element.id,
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startY: e.clientY,
                    startLengthM: element.length_m,
                    startThicknessM: element.thickness_m,
                    startElementX_m: element.x_m,
                    startElementY_m: element.y_m,
                    rotation_degrees: element.rotation_degrees,
                    anchorScreenX: handle.anchorScreenX,
                    anchorScreenY: handle.anchorScreenY,
                  };
                }}
              />
            ))}
            </React.Fragment>
          );
        })}
        {placements.map((d) => {
          const x = plotX + (d.x_m / mapData.room.width_m) * plotWidth;
          const y = plotY + (d.y_m / mapData.room.height_m) * plotHeight;
          const radiusPx = Math.max(4, ((d.size_m ?? 0.1) / 2 / mapData.room.width_m) * plotWidth);
          const nearRightBorder = x >= plotX + plotWidth * 0.9;
          const labelGap = 4;
          const labelX = nearRightBorder ? x - radiusPx - labelGap : x + radiusPx + labelGap;
          const labelAnchor = nearRightBorder ? "end" : "start";
          const isDragging = dragPlacementId === d.id;
          const isSaving = pendingSavePlacementId === d.id;
          const deviceType = d.device_type ?? "default";
          const isLight = deviceType === "light";
          const isLightOn = isLight && d.state === "on";
          const isFan = deviceType === "fan";
          const isFanOn = isFan && d.state === "on";
          const isSelected = selectedPlacementId === d.id;
          const iconStroke = isDragging ? "#f26b47" : "#000";
          return (
            <React.Fragment key={d.id}>
            <g style={{ cursor: "grab" }}
              onPointerDown={(e) => {
                e.preventDefault();
                setSelectedPlacementId(d.id);
                setSelectedElementId(null);
                pendingPlacementPressRef.current = {
                  placementId: d.id,
                  pointerId: e.pointerId,
                  startX: e.clientX,
                  startY: e.clientY,
                };
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (hiddenLabelIds.has(d.id)) {
                  onToggleLabelVisibility(d.id);
                }
              }}
            >
              {/* Invisible hit area for dragging (always present) */}
              <circle cx={x} cy={y} r={radiusPx} fill="transparent" stroke={isSaving ? "#14532d" : "none"} strokeWidth={isSaving ? 2 : 0} />

              {deviceType === "fan" && (
                <g className={isFanOn ? "fan-spinning" : undefined}>
                  <circle cx={x} cy={y} r={Math.max(2, radiusPx * 0.3)} fill={iconStroke} />
                  {[0, 90, 180, 270].map((angle) => {
                    const rad = (angle * Math.PI) / 180;
                    const bladeWidth = radiusPx * 0.5;
                    const bladeHeight = Math.max(3, radiusPx * 0.7);
                    const bladeLen = radiusPx - bladeWidth / 2;
                    const bx = x + Math.cos(rad) * bladeLen;
                    const by = y + Math.sin(rad) * bladeLen;
                    return (
                      <rect
                        key={angle}
                        x={bx - bladeWidth / 2}
                        y={by - bladeHeight / 2}
                        width={bladeWidth}
                        height={bladeHeight}
                        rx={1.5}
                        fill={iconStroke}
                        transform={`rotate(${angle}, ${bx}, ${by})`}
                      />
                    );
                  })}
                </g>
              )}

              {deviceType === "light" && (
                <g>
                  <circle cx={x} cy={y} r={radiusPx} fill={isLightOn ? "#FFD600" : "#fff"} stroke={iconStroke} strokeWidth={Math.max(1, radiusPx * 0.12)} opacity={isLightOn ? 1 : 0.85} />
                  {/* Light bulb filament hint */}
                  <circle cx={x} cy={y} r={Math.max(1, radiusPx * 0.35)} fill="none" stroke={iconStroke} strokeWidth={Math.max(0.5, radiusPx * 0.06)} opacity={0.5} />
                </g>
              )}

              {deviceType === "computer" && (
                <g>
                  <rect x={x - radiusPx * 0.7} y={y - radiusPx * 0.5} width={radiusPx * 1.4} height={radiusPx} rx={Math.max(1, radiusPx * 0.1)} fill="none" stroke={iconStroke} strokeWidth={Math.max(1, radiusPx * 0.08)} />
                  <line x1={x} y1={y + radiusPx * 0.5} x2={x} y2={y + radiusPx * 0.8} stroke={iconStroke} strokeWidth={Math.max(1, radiusPx * 0.08)} />
                  <line x1={x - radiusPx * 0.4} y1={y + radiusPx * 0.8} x2={x + radiusPx * 0.4} y2={y + radiusPx * 0.8} stroke={iconStroke} strokeWidth={Math.max(1, radiusPx * 0.08)} strokeLinecap="round" />
                </g>
              )}

              {deviceType === "switch" && (
                <g>
                  <rect x={x - radiusPx * 0.55} y={y - radiusPx * 0.7} width={radiusPx * 1.1} height={radiusPx * 1.4} rx={Math.max(1, radiusPx * 0.1)} fill="none" stroke={iconStroke} strokeWidth={Math.max(1, radiusPx * 0.08)} />
                  {/* Toggle lever */}
                  <line x1={x} y1={y - radiusPx * 0.3} x2={x} y2={y + radiusPx * 0.3} stroke={iconStroke} strokeWidth={Math.max(1.5, radiusPx * 0.12)} strokeLinecap="round" />
                  <circle cx={x} cy={y - radiusPx * 0.3} r={Math.max(1, radiusPx * 0.15)} fill={iconStroke} />
                </g>
              )}

              {deviceType === "plug" && (
                <g>
                  {/* Plug body */}
                  <rect x={x - radiusPx * 0.5} y={y - radiusPx * 0.6} width={radiusPx} height={radiusPx * 1.0} rx={Math.max(1, radiusPx * 0.1)} fill="none" stroke={iconStroke} strokeWidth={Math.max(1, radiusPx * 0.08)} />
                  {/* Two prongs */}
                  <rect x={x - radiusPx * 0.3} y={y + radiusPx * 0.4} width={radiusPx * 0.2} height={radiusPx * 0.3} fill={iconStroke} />
                  <rect x={x + radiusPx * 0.1} y={y + radiusPx * 0.4} width={radiusPx * 0.2} height={radiusPx * 0.3} fill={iconStroke} />
                </g>
              )}

              {deviceType === "sensor" && (
                <g>
                  <circle cx={x} cy={y} r={radiusPx * 0.8} fill="none" stroke={iconStroke} strokeWidth={Math.max(1, radiusPx * 0.08)} />
                  {/* Concentric sensor rings */}
                  <circle cx={x} cy={y} r={radiusPx * 0.5} fill="none" stroke={iconStroke} strokeWidth={Math.max(0.5, radiusPx * 0.05)} opacity={0.6} />
                  <circle cx={x} cy={y} r={radiusPx * 0.2} fill={iconStroke} />
                </g>
              )}

              {deviceType === "speaker" && (
                <g>
                  {/* Speaker body */}
                  <rect x={x - radiusPx * 0.5} y={y - radiusPx * 0.7} width={radiusPx} height={radiusPx * 1.4} rx={Math.max(1, radiusPx * 0.12)} fill="none" stroke={iconStroke} strokeWidth={Math.max(1, radiusPx * 0.08)} />
                  {/* Upper woofer */}
                  <circle cx={x} cy={y - radiusPx * 0.35} r={Math.max(1, radiusPx * 0.22)} fill="none" stroke={iconStroke} strokeWidth={Math.max(0.5, radiusPx * 0.06)} />
                  {/* Lower woofer */}
                  <circle cx={x} cy={y + radiusPx * 0.25} r={Math.max(1.5, radiusPx * 0.32)} fill="none" stroke={iconStroke} strokeWidth={Math.max(0.5, radiusPx * 0.06)} />
                  <circle cx={x} cy={y + radiusPx * 0.25} r={Math.max(0.5, radiusPx * 0.12)} fill={iconStroke} />
                </g>
              )}

              {deviceType === "default" && (
                <circle cx={x} cy={y} r={radiusPx} fill={isDragging ? "#f26b47" : "#ff7a59"} stroke={isSaving ? "#14532d" : "none"} strokeWidth={isSaving ? 2 : 0} />
              )}

              <text
                x={labelX}
                y={y + 4}
                fontSize="11"
                fill={hiddenLabelIds.has(d.id) ? "transparent" : "#263238"}
                textAnchor={labelAnchor}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLabelVisibility(d.id);
                }}
              >
                {d.label}
              </text>
            </g>
            {isSelected && (
              <rect
                x={x + radiusPx - 6}
                y={y - 6}
                width={12}
                height={12}
                rx={2}
                data-export-exclude="true"
                fill="#f8fafc"
                stroke="#0f172a"
                strokeWidth={1.5}
                style={{ cursor: "nwse-resize" }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedPlacementId(d.id);
                  setSelectedElementId(null);
                  pendingResizePlacementPressRef.current = {
                    placementId: d.id,
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startY: e.clientY,
                    startSizeM: d.size_m ?? 0.1,
                    centerX: x,
                    centerY: y,
                  };
                }}
              />
            )}
            </React.Fragment>
          );
        })}
        </svg>
        <svg
          width="100%"
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
          aria-hidden="true"
        >
          <line x1={plotX} y1={xAxisY} x2={plotX + plotWidth} y2={xAxisY} stroke="#6b7a7f" strokeWidth="1.5" />
          {tickFractions.map((fraction) => {
            const x = plotX + fraction * plotWidth;
            return (
              <g key={`x-${fraction}`}>
                <line x1={x} y1={xAxisY} x2={x} y2={xAxisY - 5} stroke="#6b7a7f" strokeWidth="1" />
                <text x={x} y={xAxisY - 8} fontSize="10" fill="#4d5b60" textAnchor="middle">
                  {convert(mapData.room.width_m * fraction).toFixed(1)}
                </text>
              </g>
            );
          })}
          <line x1={yAxisX} y1={plotY} x2={yAxisX} y2={plotY + plotHeight} stroke="#6b7a7f" strokeWidth="1.5" />
          {tickFractions.map((fraction) => {
            const y = plotY + fraction * plotHeight;
            return (
              <g key={`y-${fraction}`}>
                <line x1={yAxisX} y1={y} x2={yAxisX - 2.5} y2={y} stroke="#6b7a7f" strokeWidth="1" />
                <text x={yAxisX - 5} y={y + 3} fontSize="8" fill="#4d5b60" textAnchor="end">
                  {convert(mapData.room.height_m * fraction).toFixed(1)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
        <label style={{ fontSize: "0.88rem", fontWeight: 600 }}>W:</label>
        <input
          type="number"
          min={1}
          max={100}
          step={0.5}
          value={convert(mapData.room.width_m).toFixed(1)}
          onChange={(e) => {
            const w = Number(e.target.value);
            if (w < 1 || w > 100) return;
            void onResizeRoom?.(
              unit === "ft" ? w / FEET_PER_METER : w,
              mapData.room.height_m,
            );
          }}
          style={{ fontSize: "0.88rem", padding: "2px 6px", borderRadius: 4, border: "1px solid #b0bec5", width: 70 }}
        />
        <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>×</span>
        <label style={{ fontSize: "0.88rem", fontWeight: 600 }}>H:</label>
        <input
          type="number"
          min={1}
          max={100}
          step={0.5}
          value={convert(mapData.room.height_m).toFixed(1)}
          onChange={(e) => {
            const h = Number(e.target.value);
            if (h < 1 || h > 100) return;
            void onResizeRoom?.(
              mapData.room.width_m,
              unit === "ft" ? h / FEET_PER_METER : h,
            );
          }}
          style={{ fontSize: "0.88rem", padding: "2px 6px", borderRadius: 4, border: "1px solid #b0bec5", width: 70 }}
        />
        <div style={{ display: "inline-flex", border: "1px solid #b0bec5", borderRadius: 8, overflow: "hidden" }}>
          <button
            type="button"
            onClick={() => onSetUnit?.("m")}
            style={{
              padding: "3px 8px",
              border: "none",
              background: unit === "m" ? "#1f6f8b" : "#eceff1",
              color: unit === "m" ? "#fff" : "#263238",
              cursor: "pointer",
              fontSize: "0.8rem",
            }}
          >
            m
          </button>
          <button
            type="button"
            onClick={() => onSetUnit?.("ft")}
            style={{
              padding: "3px 8px",
              border: "none",
              background: unit === "ft" ? "#1f6f8b" : "#eceff1",
              color: unit === "ft" ? "#fff" : "#263238",
              cursor: "pointer",
              fontSize: "0.8rem",
            }}
          >
            ft
          </button>
        </div>
        <button
          type="button"
          onClick={() => onInsertFixture?.()}
          style={{
            border: 0,
            borderRadius: 8,
            background: "#dde8e4",
            color: "#1b2a2f",
            padding: "3px 10px",
            cursor: "pointer",
            font: "inherit",
            fontSize: "0.82rem",
          }}
        >
          Insert Fixture
        </button>
        <button
          type="button"
          onClick={() => onAssignDevices?.()}
          style={{
            border: 0,
            borderRadius: 8,
            background: "#1f6f8b",
            color: "#fff",
            padding: "3px 10px",
            cursor: "pointer",
            font: "inherit",
            fontSize: "0.82rem",
          }}
        >
          Assign Devices
        </button>
        <button
          type="button"
          onClick={() => onRemoveAllDevices?.()}
          style={{
            border: 0,
            borderRadius: 8,
            background: "#c0392b",
            color: "#fff",
            padding: "3px 10px",
            cursor: "pointer",
            font: "inherit",
            fontSize: "0.82rem",
          }}
        >
          Remove Devices
        </button>
        <button
          type="button"
          onClick={() => onRemoveAllFixtures?.()}
          style={{
            border: 0,
            borderRadius: 8,
            background: "#c0392b",
            color: "#fff",
            padding: "3px 10px",
            cursor: "pointer",
            font: "inherit",
            fontSize: "0.82rem",
          }}
        >
          Remove Fixtures
        </button>
        <div style={{ display: "inline-flex", border: "1px solid #b0bec5", borderRadius: 8, overflow: "hidden", marginLeft: "auto" }}>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
            style={{
              padding: "3px 10px",
              border: "none",
              background: "#eceff1",
              color: "#263238",
              cursor: "pointer",
              fontSize: "0.8rem",
              fontWeight: 700,
            }}
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            style={{
              padding: "3px 10px",
              border: "none",
              borderLeft: "1px solid #b0bec5",
              borderRight: "1px solid #b0bec5",
              background: "#eceff1",
              color: "#263238",
              cursor: "pointer",
              fontSize: "0.8rem",
              minWidth: 48,
            }}
            aria-label="Reset zoom"
            title="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
            style={{
              padding: "3px 10px",
              border: "none",
              background: "#eceff1",
              color: "#263238",
              cursor: "pointer",
              fontSize: "0.8rem",
              fontWeight: 700,
            }}
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
        </div>
      </div>
      {selectedElementData && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #c1d0cf",
            background: "#f5f9f8",
            display: "flex",
            gap: "10px",
            alignItems: "center",
            flexWrap: "wrap",
            fontSize: "0.85rem",
          }}
        >
          <strong style={{ fontSize: "0.85rem", color: "#1b2a2f" }}>
            Fixture Properties
          </strong>
          <label style={{ fontWeight: 600 }}>Type:</label>
          <select
            value={selectedElementData.kind}
            onChange={(e) => {
              const newKind = e.target.value as (typeof fixtureKinds)[number];
              setFixtures((prev) =>
                prev.map((el) =>
                  el.id === selectedElementData.id ? { ...el, kind: newKind } : el,
                ),
              );
              void persistElementPatch(selectedElementData.id, { kind: newKind });
            }}
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border: "1px solid #a8b8b1",
              background: "#fff",
              color: "#263238",
              font: "inherit",
              fontSize: "0.82rem",
              minWidth: 100,
            }}
          >
            {fixtureKinds.map((k) => (
              <option key={k} value={k}>
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
          <label style={{ fontWeight: 600 }}>W:</label>
          <input
            type="number"
            min={0.1}
            max={100}
            step={0.1}
            value={convert(selectedElementData.length_m).toFixed(1)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v < 0.1 || v > 100) return;
              const length_m = unit === "ft" ? v / FEET_PER_METER : v;
              setFixtures((prev) =>
                prev.map((el) =>
                  el.id === selectedElementData.id ? { ...el, length_m } : el,
                ),
              );
              void onResizeFixture?.(selectedElementData.id, { length_m });
            }}
            style={{
              fontSize: "0.82rem",
              padding: "2px 6px",
              borderRadius: 6,
              border: "1px solid #a8b8b1",
              width: 60,
            }}
          />
          <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>×</span>
          <label style={{ fontWeight: 600 }}>H:</label>
          <input
            type="number"
            min={0.1}
            max={100}
            step={0.1}
            value={convert(selectedElementData.thickness_m).toFixed(1)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v < 0.1 || v > 100) return;
              const thickness_m = unit === "ft" ? v / FEET_PER_METER : v;
              setFixtures((prev) =>
                prev.map((el) =>
                  el.id === selectedElementData.id ? { ...el, thickness_m } : el,
                ),
              );
              void onResizeFixture?.(selectedElementData.id, { length_m: selectedElementData.length_m, thickness_m });
            }}
            style={{
              fontSize: "0.82rem",
              padding: "2px 6px",
              borderRadius: 6,
              border: "1px solid #a8b8b1",
              width: 60,
            }}
          />
          <span style={{ fontSize: "0.78rem", color: "#6b7a7f" }}>{unitLabel}</span>
          {onDeleteFixture && (
            <button
              type="button"
              onClick={() => {
                void onDeleteFixture(selectedElementData.id);
                setSelectedElementId(null);
              }}
              style={{
                border: 0,
                borderRadius: 6,
                background: "#fee2e2",
                color: "#991b1b",
                padding: "3px 10px",
                cursor: "pointer",
                font: "inherit",
                fontSize: "0.82rem",
                fontWeight: 600,
              }}
              title="Delete fixture"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelectedElementId(null)}
            style={{
              border: 0,
              borderRadius: 6,
              background: "transparent",
              color: "#6b7a7f",
              padding: "3px 8px",
              cursor: "pointer",
              font: "inherit",
              fontSize: "0.82rem",
            }}
            title="Deselect"
          >
            ✕
          </button>
        </div>
      )}
      {selectedPlacementData && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #c1d0cf",
            background: "#f5f9f8",
            display: "flex",
            gap: "10px",
            alignItems: "center",
            flexWrap: "wrap",
            fontSize: "0.85rem",
          }}
        >
          <strong style={{ fontSize: "0.85rem", color: "#1b2a2f" }}>
            Device Properties
          </strong>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "2px 10px",
              width: "100%",
              fontSize: "0.82rem",
              marginBottom: 4,
            }}
          >
            <span style={{ fontWeight: 600, color: "#4d5b60" }}>Name:</span>
            <span style={{ color: "#1b2a2f" }}>{selectedPlacementData.label}</span>
            <span style={{ fontWeight: 600, color: "#4d5b60" }}>Entity ID:</span>
            <span style={{ color: "#4d5b60", fontFamily: "monospace", fontSize: "0.8rem" }}>{selectedPlacementData.entity_id}</span>
            <span style={{ fontWeight: 600, color: "#4d5b60" }}>Domain:</span>
            <span style={{ color: "#1b2a2f" }}>{selectedPlacementData.domain ?? "—"}</span>
            <span style={{ fontWeight: 600, color: "#4d5b60" }}>Area:</span>
            <span style={{ color: "#1b2a2f" }}>{selectedPlacementData.area ?? "—"}</span>
          </div>
          <input
            type="number"
            min={0.05}
            max={5}
            step={0.05}
            value={convert(selectedPlacementData.size_m ?? 0.1).toFixed(2)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v < 0.05 || v > 5) return;
              const size_m = unit === "ft" ? v / FEET_PER_METER : v;
              setPlacements((prev) =>
                prev.map((p) =>
                  p.id === selectedPlacementData.id ? { ...p, size_m } : p,
                ),
              );
              void onResizePlacement?.(selectedPlacementData.id, size_m);
            }}
            style={{
              fontSize: "0.82rem",
              padding: "2px 6px",
              borderRadius: 6,
              border: "1px solid #a8b8b1",
              width: 60,
            }}
          />
          <span style={{ fontSize: "0.82rem", color: "#4d5b60" }}>{unitLabel}</span>
          {onUpdatePlacementType && (() => {
            const currentType = selectedPlacementData.device_type ?? "default";
            const derivedType = selectedPlacementData.domain
              ? (["light", "fan", "switch", "sensor"].includes(selectedPlacementData.domain)
                  ? selectedPlacementData.domain
                  : selectedPlacementData.domain === "media_player"
                    ? "speaker"
                    : selectedPlacementData.domain === "remote" || selectedPlacementData.domain === "device_tracker"
                      ? "computer"
                      : "default")
              : "default";
            return (
              <div style={{ display: "flex", alignItems: "center", gap: "4px", width: "100%", marginTop: 2 }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#4d5b60", whiteSpace: "nowrap" }}>
                  Type:
                </span>
                <select
                  value={currentType}
                  onChange={(e) => {
                    const newType = e.target.value === "default" ? null : e.target.value;
                    setPlacements((prev) =>
                      prev.map((p) =>
                        p.id === selectedPlacementData.id ? { ...p, device_type: (newType ?? "default") as any } : p,
                      ),
                    );
                    void onUpdatePlacementType(selectedPlacementData.id, newType);
                  }}
                  style={{
                    fontSize: "0.82rem",
                    padding: "2px 6px",
                    borderRadius: 6,
                    border: "1px solid #a8b8b1",
                    flex: 1,
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <option value="default">Default (auto: {derivedType})</option>
                  <option value="light">Light</option>
                  <option value="fan">Fan</option>
                  <option value="computer">Computer</option>
                  <option value="switch">Switch</option>
                  <option value="plug">Plug</option>
                  <option value="sensor">Sensor</option>
                  <option value="speaker">Speaker</option>
                </select>
              </div>
            );
          })()}
          <button
            type="button"
            onClick={() => onToggleLabelVisibility(selectedPlacementData.id)}
            style={{
              border: 0,
              borderRadius: 6,
              background: hiddenLabelIds.has(selectedPlacementData.id) ? "#eef2f1" : "#e0f2fe",
              color: hiddenLabelIds.has(selectedPlacementData.id) ? "#6b7a7f" : "#0369a1",
              padding: "3px 10px",
              cursor: "pointer",
              font: "inherit",
              fontSize: "0.82rem",
              fontWeight: 600,
            }}
            title={hiddenLabelIds.has(selectedPlacementData.id) ? "Show label" : "Hide label"}
          >
            {hiddenLabelIds.has(selectedPlacementData.id) ? "Show label" : "Hide label"}
          </button>
          {onDeletePlacement && (
            <button
              type="button"
              onClick={() => {
                void onDeletePlacement(selectedPlacementData.id);
                setSelectedPlacementId(null);
              }}
              style={{
                border: 0,
                borderRadius: 6,
                background: "#fee2e2",
                color: "#991b1b",
                padding: "3px 10px",
                cursor: "pointer",
                font: "inherit",
                fontSize: "0.82rem",
                fontWeight: 600,
              }}
              title="Delete device"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelectedPlacementId(null)}
            style={{
              border: 0,
              borderRadius: 6,
              background: "transparent",
              color: "#6b7a7f",
              padding: "3px 8px",
              cursor: "pointer",
              font: "inherit",
              fontSize: "0.82rem",
            }}
            title="Deselect"
          >
            ✕
          </button>
        </div>
      )}
      <small style={{ display: "block", marginTop: 6, fontSize: "0.75rem", color: "#6b7a7f" }}>
        Tip: Click a fixture or device to select it, then use arrow keys to nudge. Shift+arrows for larger steps. Esc to deselect.
      </small>
    </div>
  );
}
