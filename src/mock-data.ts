import type { ForecastPoint, TrackPoint, TyphoonData } from "./types";

const HOUR = 60 * 60 * 1000;

function cstTime(t: number): string {
  const d = new Date(t + 8 * HOUR);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function trackPoint(t: number, lng: number, lat: number, speed: number, pressure: number): TrackPoint {
  return {
    time: cstTime(t),
    t,
    lng,
    lat,
    strong: speed >= 41.5 ? "强台风" : speed >= 32.7 ? "台风" : "强热带风暴",
    power: speed >= 41.5 ? 14 : speed >= 32.7 ? 12 : 10,
    speed,
    pressure,
    moveSpeed: 18,
    moveDir: "西北",
    r7: [320, 280, 260, 300],
    r10: speed >= 32.7 ? [140, 120, 100, 130] : null,
    r12: speed >= 41.5 ? [70, 60, 50, 60] : null,
  };
}

function forecastPoint(t: number, lng: number, lat: number, speed: number, pressure: number): ForecastPoint {
  return {
    time: cstTime(t),
    t,
    lng,
    lat,
    strong: speed >= 41.5 ? "强台风" : speed >= 32.7 ? "台风" : "强热带风暴",
    speed,
    pressure,
  };
}

/** 本地开发专用数据，避免开发环境依赖外部台风接口及其响应格式。 */
export function createDevTyphoonData(now = Date.now()): TyphoonData {
  const base = Math.floor(now / HOUR) * HOUR;
  const points = [
    trackPoint(base - 24 * HOUR, 130.2, 18.4, 28, 982),
    trackPoint(base - 18 * HOUR, 128.8, 19.5, 32, 970),
    trackPoint(base - 12 * HOUR, 127.2, 20.8, 36, 960),
    trackPoint(base - 6 * HOUR, 125.5, 22.2, 42, 945),
    trackPoint(base, 123.8, 23.8, 45, 938),
  ];
  const forecasts = [
    {
      agency: "中国",
      points: [
        forecastPoint(base + 12 * HOUR, 121.5, 26.0, 42, 945),
        forecastPoint(base + 24 * HOUR, 120.3, 28.6, 36, 960),
        forecastPoint(base + 36 * HOUR, 119.6, 31.2, 28, 978),
      ],
    },
    {
      agency: "日本",
      points: [
        forecastPoint(base + 12 * HOUR, 121.8, 25.8, 41, 948),
        forecastPoint(base + 24 * HOUR, 120.8, 28.3, 35, 965),
        forecastPoint(base + 36 * HOUR, 120.2, 30.9, 27, 982),
      ],
    },
  ];

  return {
    id: "dev-mock",
    name: "开发模拟台风",
    enName: "DEV MOCK",
    active: true,
    source: "本地开发模拟数据（未调用远程接口）",
    fetchedAt: new Date(now).toISOString(),
    points,
    forecasts,
  };
}
