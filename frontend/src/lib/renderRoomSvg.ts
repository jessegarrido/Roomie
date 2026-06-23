import type { RoomMapResponse } from "./types";

const FEET_PER_METER = 3.28084;

type SvgRenderOpts = {
  mapData: RoomMapResponse;
  unit: "m" | "ft";
  /** Offset X position within a larger SVG */
  offsetX?: number;
  /** Offset Y position within a larger SVG */
  offsetY?: number;
  /** Scale factor (pixels per meter). Defaults to 56. */
  scale?: number;
  /** Whether to include rulers. Defaults to true. */
  includeRulers?: boolean;
  /** Whether to include room name label. Defaults to true. */
  includeLabel?: boolean;
};

/**
 * Renders a single room map as SVG content (inner elements only, no <svg> wrapper).
 * Returns the dimensions needed for the SVG viewBox.
 */
export function renderRoomSvgContent(opts: SvgRenderOpts): {
  content: string;
  plotX: number;
  plotY: number;
  plotWidth: number;
  plotHeight: number;
  svgWidth: number;
  svgHeight: number;
} {
  const { mapData, unit, offsetX = 0, offsetY = 0, scale = 56, includeRulers = true, includeLabel = true } = opts;

  const convert = (valueMeters: number) =>
    unit === "ft" ? valueMeters * FEET_PER_METER : valueMeters;
  const unitLabel = unit === "ft" ? "ft" : "m";

  const plotWidth = Math.max(60, mapData.room.width_m * scale);
  const plotHeight = Math.max(60, mapData.room.height_m * scale);
  const ruler = { left: 28, top: 50, right: 24, bottom: 24 };
  const svgWidth = plotWidth + ruler.left + ruler.right;
  const svgHeight = plotHeight + ruler.top + ruler.bottom;
  const plotX = ruler.left;
  const plotY = ruler.top;
  const xAxisY = plotY - 8;
  const yAxisX = plotX - 8;
  const tickFractions = [0, 0.25, 0.5, 0.75, 1];

  const lines: string[] = [];
  const roomRx = 12;

  // Room background rect
  lines.push(
    `<rect x="${offsetX + plotX}" y="${offsetY + plotY}" width="${plotWidth}" height="${plotHeight}" fill="#fff" stroke="#1b2a2f" stroke-width="2" rx="${roomRx}" />`
  );

  // Drywall border – inner line flush with room edge, outer line with 4px gap
  lines.push(
    `<rect x="${offsetX + plotX - 1}" y="${offsetY + plotY - 1}" width="${plotWidth + 2}" height="${plotHeight + 2}" fill="none" stroke="#8d9aa0" stroke-width="1" rx="${roomRx + 1}" />`
  );
  lines.push(
    `<rect x="${offsetX + plotX - 5}" y="${offsetY + plotY - 5}" width="${plotWidth + 10}" height="${plotHeight + 10}" fill="none" stroke="#8d9aa0" stroke-width="1" rx="${roomRx + 5}" />`
  );

  // Rulers
  if (includeRulers) {
    lines.push(
      `<line x1="${offsetX + plotX}" y1="${offsetY + xAxisY}" x2="${offsetX + plotX + plotWidth}" y2="${offsetY + xAxisY}" stroke="#6b7a7f" stroke-width="1.5" />`
    );
    for (const fraction of tickFractions) {
      const x = offsetX + plotX + fraction * plotWidth;
      lines.push(
        `<line x1="${x}" y1="${offsetY + xAxisY}" x2="${x}" y2="${offsetY + xAxisY - 5}" stroke="#6b7a7f" stroke-width="1" />`
      );
      lines.push(
        `<text x="${x}" y="${offsetY + xAxisY - 8}" font-size="10" fill="#4d5b60" text-anchor="middle">${convert(mapData.room.width_m * fraction).toFixed(1)}</text>`
      );
    }

    lines.push(
      `<line x1="${offsetX + yAxisX}" y1="${offsetY + plotY}" x2="${offsetX + yAxisX}" y2="${offsetY + plotY + plotHeight}" stroke="#6b7a7f" stroke-width="1.5" />`
    );
    for (const fraction of tickFractions) {
      const y = offsetY + plotY + fraction * plotHeight;
      lines.push(
        `<line x1="${offsetX + yAxisX}" y1="${y}" x2="${offsetX + yAxisX - 2.5}" y2="${y}" stroke="#6b7a7f" stroke-width="1" />`
      );
      lines.push(
        `<text x="${offsetX + yAxisX - 5}" y="${y + 3}" font-size="8" fill="#4d5b60" text-anchor="end">${convert(mapData.room.height_m * fraction).toFixed(1)}</text>`
      );
    }
  }

  // Fixtures — sort so entry fixtures render last (on top, obscuring overlaps)
  const sortedFixtures = [...(mapData.fixtures ?? [])].sort((a, b) => {
    if (a.kind === "entry" && b.kind !== "entry") return 1;
    if (a.kind !== "entry" && b.kind === "entry") return -1;
    return 0;
  });
  for (const element of sortedFixtures) {
    const centerX = offsetX + plotX + (element.x_m / mapData.room.width_m) * plotWidth;
    const centerY = offsetY + plotY + (element.y_m / mapData.room.height_m) * plotHeight;
    const elementLengthPx = Math.max(12, (element.length_m / mapData.room.width_m) * plotWidth);
    const elementThicknessYPx = Math.max(6, (element.thickness_m / mapData.room.height_m) * plotHeight);
    const drawWidth = elementLengthPx;
    const drawHeight = elementThicknessYPx;
    const x = centerX - drawWidth / 2;
    const y = centerY - drawHeight / 2;
    const rotDeg = element.rotation_degrees;

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

    const needsFill = !renderAsParallelLines && !renderAsDoorDiagonal && !renderAsWindow && element.kind !== "stairs" && !renderAsVoid && !renderAsDesk && !renderAsSofa && !renderAsEntry && !renderAsSink && !renderAsFixture;

    const gTransform = `transform="rotate(${rotDeg}, ${centerX}, ${centerY})"`;

    // Hit area rect (transparent for special kinds)
    lines.push(
      `<g ${gTransform}>`
    );
    lines.push(
      `<rect x="${x}" y="${y}" width="${drawWidth}" height="${drawHeight}" rx="2" fill="${needsFill ? fill : "transparent"}" opacity="${renderAsParallelLines ? 1 : 0.95}" />`
    );

    if (renderAsParallelLines) {
      lines.push(
        `<line x1="${x}" y1="${centerY - lineGap}" x2="${x + drawWidth}" y2="${centerY - lineGap}" stroke="${fill}" stroke-width="${lineStrokeWidth}" />`
      );
      lines.push(
        `<line x1="${x}" y1="${centerY + lineGap}" x2="${x + drawWidth}" y2="${centerY + lineGap}" stroke="${fill}" stroke-width="${lineStrokeWidth}" />`
      );
    }

    if (renderAsDoorDiagonal) {
      const doorRectX = x + drawWidth / 2 - 3;
      const doorRectY = y;
      const doorRectW = 6;
      const doorRectH = Math.sqrt(drawWidth * drawWidth + drawHeight * drawHeight);
      const doorRotateX = x + drawWidth / 2;
      const doorRotateY = y + drawHeight / 2;
      lines.push(
        `<rect x="${doorRectX}" y="${doorRectY}" width="${doorRectW}" height="${doorRectH}" transform="rotate(30 ${doorRotateX} ${doorRotateY})" fill="none" stroke="#000000" stroke-width="1.5" />`
      );
    }

    if (renderAsWindow) {
      lines.push(
        `<line x1="${x}" y1="${centerY - lineGap}" x2="${x + drawWidth}" y2="${centerY - lineGap}" stroke="${windowStroke}" stroke-width="1.1" />`
      );
      lines.push(
        `<line x1="${x}" y1="${centerY + lineGap}" x2="${x + drawWidth}" y2="${centerY + lineGap}" stroke="${windowStroke}" stroke-width="1.1" />`
      );
      lines.push(
        `<line x1="${centerX}" y1="${centerY - lineGap - 1.5}" x2="${centerX}" y2="${centerY + lineGap + 1.5}" stroke="${windowStroke}" stroke-width="0.9" />`
      );
    }

    if (element.kind === "stairs") {
      lines.push(
        `<rect x="${x}" y="${y}" width="${drawWidth}" height="${drawHeight}" rx="2" fill="#e5e7eb" fill-opacity="0.3" stroke="none" />`
      );
      for (const step of [0.2, 0.4, 0.6, 0.8]) {
        const stepX = x + drawWidth * step;
        lines.push(
          `<line x1="${stepX}" y1="${y}" x2="${stepX}" y2="${y + drawHeight}" stroke="#000000" stroke-width="1" />`
        );
      }
    }

    if (renderAsVoid) {
      lines.push(
        `<rect x="${x}" y="${y}" width="${drawWidth}" height="${drawHeight}" fill="none" stroke="#000000" stroke-width="1.2" stroke-dasharray="4 2" />`
      );
      lines.push(
        `<line x1="${x}" y1="${y}" x2="${x + drawWidth}" y2="${y + drawHeight}" stroke="#000000" stroke-width="1" />`
      );
      lines.push(
        `<line x1="${x + drawWidth}" y1="${y}" x2="${x}" y2="${y + drawHeight}" stroke="#000000" stroke-width="1" />`
      );
    }

    if (renderAsDesk) {
      lines.push(
        `<rect x="${x}" y="${y}" width="${drawWidth}" height="${drawHeight}" rx="2" fill="#8b6a4d" fill-opacity="0.15" stroke="#000000" stroke-width="1.2" />`
      );
      lines.push(
        `<line x1="${x + drawWidth * 0.15}" y1="${centerY}" x2="${x + drawWidth * 0.85}" y2="${centerY}" stroke="#000000" stroke-width="1" />`
      );
    }

    if (renderAsSofa) {
          const rx = Math.max(4, Math.min(drawWidth, drawHeight) * 0.25);
          lines.push(
            `<rect x="${x}" y="${y}" width="${drawWidth}" height="${drawHeight}" rx="${rx}" fill="#94a3b8" fill-opacity="0.15" stroke="#000000" stroke-width="1.2" />`
          );
          lines.push(
            `<line x1="${x + drawWidth * 0.08}" y1="${y + drawHeight * 0.28}" x2="${x + drawWidth * 0.92}" y2="${y + drawHeight * 0.28}" stroke="#000000" stroke-width="1" />`
          );
        }

        if (renderAsEntry) {
          lines.push(
            `<rect x="${x}" y="${y}" width="${drawWidth}" height="${drawHeight}" rx="2" fill="#fff" stroke="#000000" stroke-width="1.4" />`
          );
        }

        if (renderAsFixture) {
          lines.push(
            `<rect x="${x}" y="${y}" width="${drawWidth}" height="${drawHeight}" rx="2" fill="none" stroke="#000000" stroke-width="1.4" />`
          );
          lines.push(
            `<line x1="${x}" y1="${y}" x2="${x + drawWidth}" y2="${y + drawHeight}" stroke="#000000" stroke-width="0.8" />`
          );
        }

        if (renderAsSink) {
          // Sink: black line design with no background fill
          // Outer basin outline (rounded rect, no fill)
          const basinRx = Math.max(2, Math.min(drawWidth, drawHeight) * 0.15);
          lines.push(
            `<rect x="${x}" y="${y}" width="${drawWidth}" height="${drawHeight}" rx="${basinRx}" fill="none" stroke="#000000" stroke-width="1.4" />`
          );
          // Inner basin (inset, slightly smaller rounded rect)
          const inset = Math.max(1.5, Math.min(drawWidth, drawHeight) * 0.08);
          lines.push(
            `<rect x="${x + inset}" y="${y + inset}" width="${drawWidth - 2 * inset}" height="${drawHeight - 2 * inset}" rx="${basinRx * 0.7}" fill="none" stroke="#000000" stroke-width="1" />`
          );
          // Faucet: short vertical line at top center extending above the basin
          const faucetW = Math.max(1.5, Math.min(drawWidth, drawHeight) * 0.06);
          const faucetH = Math.max(4, drawHeight * 0.25);
          lines.push(
            `<rect x="${centerX - faucetW / 2}" y="${y - faucetH}" width="${faucetW}" height="${faucetH}" fill="none" stroke="#000000" stroke-width="1" />`
          );
          // Drain: small circle at center of basin
          const drainR = Math.max(1, Math.min(drawWidth, drawHeight) * 0.06);
          lines.push(
            `<circle cx="${centerX}" cy="${centerY}" r="${drainR}" fill="none" stroke="#000000" stroke-width="1" />`
          );
        }

    lines.push(`</g>`);
  }

  // Device placements
  for (const d of mapData.placements) {
    const x = offsetX + plotX + (d.x_m / mapData.room.width_m) * plotWidth;
    const y = offsetY + plotY + (d.y_m / mapData.room.height_m) * plotHeight;
    const nearRightBorder = x - offsetX >= plotX + plotWidth * 0.9;
    const labelX = nearRightBorder ? x - 10 : x + 10;
    const labelAnchor = nearRightBorder ? "end" : "start";
    const isLight = d.entity_id?.startsWith("light.");
    const isLightOn = isLight && d.state === "on";
    const isFan = d.entity_id?.startsWith("fan.");
    const isFanOn = isFan && d.state === "on";

    if (isFan) {
      // Ceiling fan icon: center hub + 4 blades
      const fanGroupAttrs = isFanOn ? ' class="fan-spinning" style="transform-box: fill-box; transform-origin: center center;"' : "";
      lines.push(
        `<g${fanGroupAttrs}>`
      );
      lines.push(
        `<circle cx="${x}" cy="${y}" r="2" fill="#000" />`
      );
      for (const angle of [0, 90, 180, 270]) {
        const rad = (angle * Math.PI) / 180;
        const bladeLen = 7;
        const bladeWidth = 3.5;
        const bx = x + Math.cos(rad) * bladeLen;
        const by = y + Math.sin(rad) * bladeLen;
        lines.push(
          `<rect x="${bx - bladeWidth / 2}" y="${by - 1}" width="${bladeWidth}" height="5" rx="1.5" fill="#000" transform="rotate(${angle}, ${bx}, ${by})" />`
        );
      }
      lines.push(`</g>`);
    } else if (isLight) {
      const lightFill = isLightOn ? "#FFD600" : "none";
      lines.push(
        `<circle cx="${x}" cy="${y}" r="7" fill="${lightFill}" stroke="#000" stroke-width="2" />`
      );
    } else {
      lines.push(
        `<circle cx="${x}" cy="${y}" r="7" fill="#ff7a59" />`
      );
    }
    lines.push(
      `<text x="${labelX}" y="${y + 4}" font-size="11" fill="#263238" text-anchor="${labelAnchor}">${escapeXml(d.label)}</text>`
    );
  }

  // Room name label
  if (includeLabel) {
    lines.push(
      `<text x="${offsetX + plotX + plotWidth / 2}" y="${offsetY + plotY + 18}" text-anchor="middle" font-size="12" fill="#1b2a2f" font-weight="700">${escapeXml(mapData.room.name)}</text>`
    );
    lines.push(
      `<text x="${offsetX + plotX + plotWidth / 2}" y="${offsetY + plotY + plotHeight - 8}" text-anchor="middle" font-size="10" fill="#4d5b60">${convert(mapData.room.width_m).toFixed(1)} x ${convert(mapData.room.height_m).toFixed(1)} ${unitLabel}</text>`
    );
  }

  return {
    content: lines.join("\n"),
    plotX,
    plotY,
    plotWidth,
    plotHeight,
    svgWidth,
    svgHeight,
  };
}

/**
 * Renders just the ruler elements for a single room map as SVG content.
 * Used to overlay rulers outside the main SVG so they are excluded from exports.
 */
export function renderRulerContent(opts: SvgRenderOpts): string {
  const { mapData, unit, offsetX = 0, offsetY = 0, scale = 56 } = opts;

  const convert = (valueMeters: number) =>
    unit === "ft" ? valueMeters * FEET_PER_METER : valueMeters;

  const plotWidth = Math.max(60, mapData.room.width_m * scale);
  const plotHeight = Math.max(60, mapData.room.height_m * scale);
  const ruler = { left: 28, top: 50, right: 24, bottom: 24 };
  const plotX = offsetX + ruler.left;
  const plotY = offsetY + ruler.top;
  const xAxisY = plotY - 20;
  const yAxisX = plotX - 20;
  const tickFractions = [0, 0.25, 0.5, 0.75, 1];

  const lines: string[] = [];

  // X-axis ruler
  lines.push(
    `<line x1="${plotX}" y1="${xAxisY}" x2="${plotX + plotWidth}" y2="${xAxisY}" stroke="#6b7a7f" stroke-width="1.5" />`
  );
  for (const fraction of tickFractions) {
    const x = plotX + fraction * plotWidth;
    lines.push(
      `<line x1="${x}" y1="${xAxisY}" x2="${x}" y2="${xAxisY - 5}" stroke="#6b7a7f" stroke-width="1" />`
    );
    lines.push(
      `<text x="${x}" y="${xAxisY - 8}" font-size="10" fill="#4d5b60" text-anchor="middle">${convert(mapData.room.width_m * fraction).toFixed(1)}</text>`
    );
  }

  // Y-axis ruler
  lines.push(
    `<line x1="${yAxisX}" y1="${plotY}" x2="${yAxisX}" y2="${plotY + plotHeight}" stroke="#6b7a7f" stroke-width="1.5" />`
  );
  for (const fraction of tickFractions) {
    const y = plotY + fraction * plotHeight;
    lines.push(
      `<line x1="${yAxisX}" y1="${y}" x2="${yAxisX - 2.5}" y2="${y}" stroke="#6b7a7f" stroke-width="1" />`
    );
    lines.push(
      `<text x="${yAxisX - 5}" y="${y + 3}" font-size="8" fill="#4d5b60" text-anchor="end">${convert(mapData.room.height_m * fraction).toFixed(1)}</text>`
    );
  }

  return lines.join("\n");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generates a complete SVG string for a single room map.
 */
export function renderRoomMapSvg(mapData: RoomMapResponse, unit: "m" | "ft"): string {
  const { content, svgWidth, svgHeight } = renderRoomSvgContent({ mapData, unit });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" role="img" aria-label="${escapeXml(mapData.room.name)} map">`,
    content,
    `</svg>`,
  ].join("\n");
}

/**
 * Generates a composite SVG string for a floor map of multiple rooms.
 */
export function renderFloorMapSvg(
  roomsData: RoomMapResponse[],
  unit: "m" | "ft",
  scale = 56,
  gap = 12,
  padding = 20,
): string {
  if (roomsData.length === 0) return "";

  const unitLabel = unit === "ft" ? "ft" : "m";
  const convert = (valueMeters: number) =>
    unit === "ft" ? valueMeters * FEET_PER_METER : valueMeters;

  // Calculate dimensions for each room
  const roomRects = roomsData.map((mapData) => {
    const { svgWidth, svgHeight } = renderRoomSvgContent({ mapData, unit, scale, includeRulers: false, includeLabel: false });
    return {
      mapData,
      svgWidth,
      svgHeight,
    };
  });

  const maxRoomHeight = roomRects.reduce((max, r) => Math.max(max, r.svgHeight), 0);
  const totalWidth = roomRects.reduce((sum, r) => sum + r.svgWidth, 0) + gap * (roomRects.length - 1);
  const compositeWidth = padding * 2 + totalWidth;
  const compositeHeight = padding * 2 + maxRoomHeight + 24;

  let cursorX = padding;
  const roomSvgParts: string[] = [];

  for (const roomRect of roomRects) {
    const yOffset = padding + (maxRoomHeight - roomRect.svgHeight) / 2;
    const { content } = renderRoomSvgContent({
      mapData: roomRect.mapData,
      unit,
      scale,
      offsetX: cursorX,
      offsetY: yOffset,
      includeRulers: true,
      includeLabel: true,
    });
    roomSvgParts.push(content);
    cursorX += roomRect.svgWidth + gap;
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${compositeWidth}" height="${compositeHeight}" viewBox="0 0 ${compositeWidth} ${compositeHeight}" role="img" aria-label="Floor map layout">`,
    ...roomSvgParts,
    `</svg>`,
  ].join("\n");
}