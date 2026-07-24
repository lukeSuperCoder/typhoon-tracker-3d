import type { Quad, TrackPoint } from "./types";

const R = 6371; // 地球半径 km
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** 两点球面距离（km） */
export function haversineKm(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const dφ = (lat2 - lat1) * D2R;
  const dλ = (lng2 - lng1) * D2R;
  const a =
    Math.sin(dφ / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 从 (lng,lat) 沿方位角 bearing（度，正北为 0）走 dist 公里后的坐标 */
export function destination(lng: number, lat: number, bearing: number, dist: number): [number, number] {
  const δ = dist / R;
  const θ = bearing * D2R;
  const φ1 = lat * D2R;
  const λ1 = lng * D2R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [λ2 * R2D, φ2 * R2D];
}

/**
 * 四象限不等半径风圈多边形（GeoJSON ring）。
 * quad 顺序：东北(0°-90°) | 东南(90°-180°) | 西南(180°-270°) | 西北(270°-360°)
 *
 * 逐象限迭代，确保每个象限精确覆盖 90° 圆心角。
 * 相邻象限在边界角度各生成一个点（不同半径），自然形成径向分割线。
 */
export function windCircleRing(lng: number, lat: number, quad: Quad): [number, number][] {
  const ring: [number, number][] = [];
  const STEP = 3; // 必须整除 90，保证边界角度（0°/90°/180°/270°/360°）被精确采样
  for (let q = 0; q < 4; q++) {
    const start = q * 90;
    const end = (q + 1) * 90;
    for (let b = start; b <= end; b += STEP) {
      ring.push(destination(lng, lat, b % 360, quad[q]));
    }
  }
  ring.push(ring[0]);
  return ring;
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/** 将经度归一化到 [-180, 180)。 */
export function normalizeLongitude(lng: number): number {
  return ((lng + 180) % 360 + 360) % 360 - 180;
}

/** 沿最短经度方向插值，正确跨越日期变更线。 */
export function interpolateLongitude(a: number, b: number, f: number): number {
  const delta = normalizeLongitude(b - a);
  return normalizeLongitude(a + delta * f);
}

/** 两点间初始球面方位角（正北为 0°）。 */
export function bearingBetween(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const φ1 = lat1 * D2R;
  const φ2 = lat2 * D2R;
  const dλ = normalizeLongitude(lng2 - lng1) * D2R;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** 球面大圆插值；极短距离退化为经纬度最短路径插值。 */
export function interpolateGreatCircle(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
  f: number,
): [number, number] {
  const φ1 = lat1 * D2R;
  const λ1 = lng1 * D2R;
  const φ2 = lat2 * D2R;
  const λ2 = (lng1 + normalizeLongitude(lng2 - lng1)) * D2R;
  const cosDelta = Math.min(1, Math.max(-1,
    Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1),
  ));
  const delta = Math.acos(cosDelta);
  if (delta < 1e-8) return [interpolateLongitude(lng1, lng2, f), lerp(lat1, lat2, f)];
  const sinDelta = Math.sin(delta);
  const a = Math.sin((1 - f) * delta) / sinDelta;
  const b = Math.sin(f * delta) / sinDelta;
  const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
  const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
  const z = a * Math.sin(φ1) + b * Math.sin(φ2);
  return [normalizeLongitude(Math.atan2(y, x) * R2D), Math.atan2(z, Math.hypot(x, y)) * R2D];
}

function lerpQuad(a: Quad | null, b: Quad | null, f: number): Quad | null {
  if (a && b) return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f)];
  return f < 0.5 ? a : b;
}

export interface TrackState {
  lng: number;
  lat: number;
  speed: number;
  pressure: number;
  strong: string;
  power: number | null;
  moveSpeed: number | null;
  moveDir: string | null;
  r7: Quad | null;
  r10: Quad | null;
  r12: Quad | null;
  time: string;
  index: number; // 所处区间左端点下标
  frac: number;
}

/** 在轨迹上按时间 t 插值出台风状态（t 超界时钳到端点） */
export function stateAtTime(points: TrackPoint[], t: number): TrackState {
  const first = points[0];
  const last = points[points.length - 1];
  if (t <= first.t) return { ...pick(first), index: 0, frac: 0 };
  if (t >= last.t) return { ...pick(last), index: points.length - 1, frac: 0 };

  // 二分查找区间左端点，避免长历史轨迹每帧线性扫描。
  let low = 0;
  let high = points.length - 2;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (points[mid + 1].t <= t) low = mid + 1;
    else high = mid - 1;
  }
  const i = low;
  const a = points[i];
  const b = points[i + 1];
  const f = (t - a.t) / (b.t - a.t);
  const disc = f < 0.5 ? a : b;
  const [lng, lat] = interpolateGreatCircle(a.lng, a.lat, b.lng, b.lat, f);
  return {
    lng,
    lat,
    speed: lerp(a.speed, b.speed, f),
    pressure: lerp(a.pressure, b.pressure, f),
    strong: disc.strong,
    power: disc.power,
    moveSpeed: disc.moveSpeed,
    moveDir: disc.moveDir,
    r7: lerpQuad(a.r7, b.r7, f),
    r10: lerpQuad(a.r10, b.r10, f),
    r12: lerpQuad(a.r12, b.r12, f),
    time: disc.time,
    index: i,
    frac: f,
  };
}

function pick(p: TrackPoint) {
  const { lng, lat, speed, pressure, strong, power, moveSpeed, moveDir, r7, r10, r12, time } = p;
  return { lng, lat, speed, pressure, strong, power, moveSpeed, moveDir, r7, r10, r12, time };
}
