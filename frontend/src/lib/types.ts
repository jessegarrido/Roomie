export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type DeviceType = "light" | "fan" | "computer" | "switch" | "plug" | "sensor" | "speaker" | "default";

export type DevicePlacement = {
  id: number;
  entity_id?: string;
  label: string;
  x_m: number;
  y_m: number;
  size_m?: number;
  state?: string;
  domain?: string;
  area?: string | null;
  device_type?: DeviceType;
  device_type_override?: string | null;
};

export type Fixture = {
  id: number;
  kind: "wall" | "door" | "window" | "stairs" | "void" | "desk" | "sofa" | "entry" | "sink" | "fixture";
  rotation_degrees: number;
  length_m: number;
  thickness_m: number;
  x_m: number;
  y_m: number;
};

export type FloorSummary = {
  id: number;
  name: string;
  level: number;
};

export type RoomSummary = {
  id: number;
  name: string;
  width_m: number;
  height_m: number;
  floor_id?: number | null;
};

export type DiscoveredDevice = {
  entity_id: string;
  name: string;
  domain: string;
  area?: string | null;
  state?: string;
};

export type RoomMapResponse = {
  room: {
    id: number;
    name: string;
    width_m: number;
    height_m: number;
  };
  placements: DevicePlacement[];
  fixtures?: Fixture[];
};
