// Mock WMS data + types
export type ZoneType =
  | "Raw Material"
  | "Finished Goods"
  | "Fast Moving"
  | "Slow Moving"
  | "Hazardous"
  | "Cold Storage"
  | "Returns"
  | "QC Hold";

export type BinStatus = "Empty" | "Partial" | "Full" | "Reserved" | "Blocked" | "Damaged";

export interface Bin {
  id: string;
  code: string;
  status: BinStatus;
  occupancy: number; // 0-1
  sku?: string;
  pallets: number;
  // Extended inventory tracking (Sprint 1B)
  batchNumber?: string;
  expiryDate?: string;
  quantity?: number;
  capacity?: number;
}

export interface Rack {
  id: string;
  code: string;
  position: [number, number]; // x, z grid
  rotation: 0 | 90;
  levels: number;
  binsPerLevel: number;
  bins: Bin[];
}

export interface Aisle {
  id: string;
  code: string;
  racks: Rack[];
}

export interface Zone {
  id: string;
  name: string;
  type: ZoneType;
  color: string;
  bounds: { x: number; z: number; w: number; d: number };
  utilization: number;
  activity: number;
  aisles: Aisle[];
}

export interface Dock {
  id: string;
  code: string;
  kind: "Inbound" | "Outbound";
  occupied: boolean;
  truckId?: string;
  position: [number, number];
}

export interface Forklift {
  id: string;
  code: string;
  path: [number, number][];
  speed: number;
}

export interface Warehouse {
  name: string;
  size: { w: number; d: number };
  zones: Zone[];
  docks: Dock[];
  forklifts: Forklift[];
}

export const ZONE_COLORS: Record<ZoneType, string> = {
  "Raw Material": "#d97706",
  "Finished Goods": "#0891b2",
  "Fast Moving": "#16a34a",
  "Slow Moving": "#6366f1",
  Hazardous: "#dc2626",
  "Cold Storage": "#06b6d4",
  Returns: "#a855f7",
  "QC Hold": "#eab308",
};

function makeBins(rackId: string, levels: number, perLevel: number): Bin[] {
  const bins: Bin[] = [];
  const statuses: BinStatus[] = ["Empty", "Partial", "Full", "Reserved", "Blocked"];
  for (let l = 0; l < levels; l++) {
    for (let p = 0; p < perLevel; p++) {
      const status: BinStatus = "Empty";
      bins.push({
        id: `${rackId}-L${l + 1}-${p + 1}`,
        code: `${rackId}-${String.fromCharCode(65 + l)}${p + 1}`,
        status,
        occupancy: 0,
        sku: undefined,
        pallets: 0,
      });
    }
  }
  return bins;
}

/** Creates a zone with NO aisles/racks — user adds racks manually via drag-and-drop */
export function makeEmptyZone(
  name: string,
  type: ZoneType,
  bounds: Zone["bounds"],
): Zone {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    type,
    color: ZONE_COLORS[type],
    bounds,
    utilization: 0,
    activity: Math.random() * 0.8 + 0.2,
    aisles: [],
  };
}

/** Creates a standalone rack (no bins) to be placed inside a zone */
export function makeEmptyRack(
  zoneId: string,
  rackIndex: number,
  position: [number, number],
): Rack {
  const rackId = `${zoneId.slice(0, 4).toUpperCase()}-R${rackIndex}`;
  return {
    id: rackId,
    code: rackId,
    position,
    rotation: 0,
    levels: 4,
    binsPerLevel: 4,
    bins: [],
  };
}

/** Generates N bins and appends them to a rack (called after user confirms bin count) */
export function generateBinsForRack(rack: Rack, count: number): Bin[] {
  const bins: Bin[] = [];
  for (let i = 0; i < count; i++) {
    const binId = `${rack.id}-B${i + 1}`;
    bins.push({
      id: binId,
      code: binId,
      status: "Empty",
      occupancy: 0,
      pallets: 0,
    });
  }
  return bins;
}

// Distance between consecutive rack-column centerlines. The forklift model is
// 0.7 wide (see ForkliftMesh); at the old pitch of 4 the walkable gap between
// columns worked out to only 0.6 — narrower than the forklift itself, so it
// always looked like it was clipping through the racks no matter how its path
// was routed. 4.6 opens that gap to 1.2, wide enough to actually drive through,
// while still fitting inside every zone's existing bounds.w.
export const AISLE_PITCH = 4.6;
const RACK_HALF_W = 0.8;   // half of RackMesh's rackW (1.6)
const RACK_HALF_D = 0.3;   // half of RackMesh's rackD (0.6)
const SIDE_OFFSET = 0.9;   // L/R rack offset from a column's centerline
const ROW_PITCH = 2.2;     // distance between rack rows along z

// Where the first rack column/row should start so the whole rack block is
// centered inside the zone, instead of hugging bounds.x/bounds.z — the old
// fixed "+1.5" offset left the block off-center (and even overhanging the
// zone's left edge once AISLE_PITCH grew), so racks visually didn't line up
// with the section they belonged to.
function rackBlockOrigin(bounds: Zone["bounds"], aisleCount: number, racksPerAisle: number) {
  const blockW = (aisleCount - 1) * AISLE_PITCH + 2 * (SIDE_OFFSET + RACK_HALF_W);
  const blockD = (racksPerAisle - 1) * ROW_PITCH + 2 * RACK_HALF_D;
  const startX = bounds.x + bounds.w / 2 - blockW / 2 + (SIDE_OFFSET + RACK_HALF_W);
  const startZ = bounds.z + bounds.d / 2 - blockD / 2 + RACK_HALF_D;
  return { startX, startZ, blockW, blockD };
}

export function makeZone(
  name: string,
  type: ZoneType,
  bounds: Zone["bounds"],
  aisleCount: number,
  racksPerAisle: number,
  opts: { levels?: number; binsPerLevel?: number; totalBins?: number } = {},
): Zone {
  const { startX, startZ } = rackBlockOrigin(bounds, aisleCount, racksPerAisle);
  const aisles: Aisle[] = [];
  for (let a = 0; a < aisleCount; a++) {
    const racks: Rack[] = [];
    for (let r = 0; r < racksPerAisle; r++) {
      const rid = `${name.slice(0, 2).toUpperCase()}-A${a + 1}-R${r + 1}`;
      const levels = opts.levels ?? 4;
      const binsPerLevel = opts.binsPerLevel ?? 4;
      // Two rows of racks per aisle
      for (const side of [0, 1]) {
        const rackId = `${rid}-${side === 0 ? "L" : "R"}`;
        const x = startX + a * AISLE_PITCH + (side === 0 ? -SIDE_OFFSET : SIDE_OFFSET);
        const z = startZ + r * ROW_PITCH;
        racks.push({
          id: rackId,
          code: rackId,
          position: [x, z],
          rotation: 0,
          levels,
          binsPerLevel,
          bins: makeBins(rackId, levels, binsPerLevel),
        });
      }
    }
    aisles.push({ id: `${name}-A${a + 1}`, code: `Aisle ${a + 1}`, racks });
  }
  // Exact capacity: drop surplus bin positions from the last racks (and empty racks).
  if (opts.totalBins) {
    let excess = aisles.flatMap((a) => a.racks).reduce((n, r) => n + r.bins.length, 0) - opts.totalBins;
    for (let ai = aisles.length - 1; ai >= 0 && excess > 0; ai--) {
      const racks = aisles[ai].racks;
      for (let ri = racks.length - 1; ri >= 0 && excess > 0; ri--) {
        const rack = racks[ri];
        const cut = Math.min(excess, rack.bins.length);
        rack.bins.splice(rack.bins.length - cut, cut);
        excess -= cut;
        if (rack.bins.length === 0) racks.splice(ri, 1);
      }
    }
  }
  const allBins = aisles.flatMap((a) => a.racks.flatMap((r) => r.bins));
  const utilization =
    allBins.reduce((s, b) => s + b.occupancy, 0) / Math.max(1, allBins.length);
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    type,
    color: ZONE_COLORS[type],
    bounds,
    utilization,
    activity: Math.random() * 0.8 + 0.2,
    aisles,
  };
}

// Builds a closed-loop forklift path that stays in the open cross-aisle gaps
// between rack columns/rows instead of a hand-picked (x, z) rectangle — a
// hardcoded path desyncs the moment a zone's bounds/aisleCount/racksPerAisle
// changes and ends up clipping straight through the rack meshes it was meant
// to drive around (see makeZone's rack x/z placement math below, which this
// mirrors exactly).
function computeAislePath(
  bounds: Zone["bounds"],
  aisleCount: number,
  racksPerAisle: number,
): [number, number][] {
  if (aisleCount < 2) return []; // no open gap between rack columns to drive through
  const { startX, startZ, blockD } = rackBlockOrigin(bounds, aisleCount, racksPerAisle);
  // Gap between column `a`'s R side and column `a+1`'s L side is centered
  // halfway between their centerlines.
  const gapXs = Array.from({ length: aisleCount - 1 }, (_, a) => startX + AISLE_PITCH * (a + 0.5));
  const x1 = gapXs[0];
  const x2 = gapXs[gapXs.length - 1];
  // Open cross-aisle strips in the margin before the first rack row and after
  // the last one (the rack block is now centered in the zone, so these margins
  // are symmetric).
  const frontMargin = (bounds.d - blockD) / 2;
  const zFront = bounds.z + frontMargin / 2;
  const zBack = bounds.z + bounds.d - frontMargin / 2;
  if (x1 === x2) return [[x1, zFront], [x1, zBack]]; // only one gap — drive it back and forth
  return [[x1, zFront], [x1, zBack], [x2, zBack], [x2, zFront]];
}

// ─── Kadapa CP PLUS Centralized Warehouse (AIL Dixon Technologies) ──────────
// RM: 17,592 pallet positions in high-bay racking (6 levels x 8 positions per rack bay).
// FG: 1,000 floor-storage positions. Daily flow: ~350 pallets in, ~500 pallets out.
export const KADAPA_RM_POSITIONS = 17592;
export const KADAPA_FG_POSITIONS = 1000;

const RM_BOUNDS = { x: -68, z: -40, w: 64, d: 44 };
const FG_BOUNDS = { x: 4, z: -40, w: 28, d: 30 };

export const warehouse: Warehouse = {
  name: "DIXON-KDP-CWH",
  size: { w: 140, d: 110 },
  zones: [
    makeZone("Inbound Staging", "Raw Material", { x: -68, z: -52, w: 40, d: 10 }, 2, 4),
    makeZone("RM High-Bay", "Raw Material", RM_BOUNDS, 12, 17,
      { levels: 6, binsPerLevel: 8, totalBins: KADAPA_RM_POSITIONS }),
    makeZone("FG Floor Storage", "Finished Goods", FG_BOUNDS, 4, 11,
      { levels: 1, binsPerLevel: 12, totalBins: KADAPA_FG_POSITIONS }),
    makeZone("Outbound Staging", "Finished Goods", { x: 4, z: 30, w: 40, d: 14 }, 2, 4),
    makeZone("QC / Quarantine", "QC Hold", { x: 50, z: -40, w: 16, d: 12 }, 2, 3),
    makeZone("CCTV Assembly Line-side", "Fast Moving", { x: 50, z: -24, w: 16, d: 14 }, 2, 3),
    makeZone("HG Plant Bins", "Returns", { x: 50, z: -6, w: 16, d: 12 }, 2, 3),
  ],
  docks: [
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `dock-in-${i + 1}`,
      code: `IN-${i + 1}`,
      kind: "Inbound" as const,
      occupied: false,
      position: [-62 + i * 12, -53.8] as [number, number],
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `dock-out-${i + 1}`,
      code: `OUT-${i + 1}`,
      kind: "Outbound" as const,
      occupied: false,
      position: [-62 + i * 12, 53.8] as [number, number],
    })),
  ],
  forklifts: [
    { id: "fl-1", code: "RT-01", path: computeAislePath(RM_BOUNDS, 12, 17), speed: 0.4 },
    { id: "fl-2", code: "RT-02", path: computeAislePath(RM_BOUNDS, 12, 17), speed: 0.3 },
    { id: "fl-3", code: "FL-01", path: computeAislePath(FG_BOUNDS, 4, 11), speed: 0.5 },
  ],
};

export function totalKPIs(w: Warehouse) {
  const allBins = w.zones.flatMap((z) =>
    z.aisles.flatMap((a) => a.racks.flatMap((r) => r.bins)),
  );
  const total = allBins.length;
  const occupied = allBins.filter((b) => b.status !== "Empty").length;
  const blocked = allBins.filter((b) => b.status === "Blocked" || b.status === "Damaged").length;
  const utilization = allBins.reduce((s, b) => s + b.occupancy, 0) / total;
  return { totalBins: total, occupied, blocked, utilization };
}
