import "mapbox-gl/dist/mapbox-gl.css";
import "./style.css";
import { createTyphoonMap } from "./map";
import type { CameraMode, LayerVisibility, PerformanceTier } from "./map/contracts";
import type { TyphoonData } from "./types";
import { createDevTyphoonData } from "./mock-data";
import { intensityOf, INTENSITY_ORDER, agencyColor, powerValue, powerUnit } from "./intensity";
import { renderGuide, openGuideModal, setGuideContext } from "./guide";
import { initNews, refreshNews } from "./news";
import { initOfficialFeed } from "./official";
import { initSlogans } from "./slogan";
import { openShareModal, type SharePayload } from "./share";
import type { PosterData } from "./poster";
import { openOriginModal } from "./origin";
import { initMusic } from "./music";
import { initMobile, isMobile, syncAlertBannerHost } from "./mobile";
import { plainMoveDir } from "./direction";
import { computeImpacts, formatEta, CITIES, MY_LOCATION, type City, type CityImpact } from "./impact";
import { PlaybackEngine } from "./animation/PlaybackEngine";

const TYPHOON_ID = "202609"; // 2026 年第 9 号台风 巴威 BAVI
const REFRESH_MS = 5 * 60 * 1000;

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const tmap = createTyphoonMap("map");

let data: TyphoonData | null = null;
let latestImpacts: CityImpact[] = [];

/** ———— 我的位置：坐标只存本机 localStorage，倒计时在本机计算，绝不上传 ———— */
const MY_LOC_KEY = "bavi:my-location";

function loadMyLocation(): City | null {
  try {
    const raw = localStorage.getItem(MY_LOC_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { lng: number; lat: number };
    if (typeof p.lng !== "number" || typeof p.lat !== "number") return null;
    return { name: MY_LOCATION, lng: p.lng, lat: p.lat };
  } catch {
    return null;
  }
}

let myLocation: City | null = loadMyLocation();

function saveMyLocation(loc: City | null): void {
  myLocation = loc;
  try {
    if (loc) localStorage.setItem(MY_LOC_KEY, JSON.stringify({ lng: loc.lng, lat: loc.lat }));
    else localStorage.removeItem(MY_LOC_KEY);
  } catch {
    /* 隐私模式下 localStorage 不可用，定位仅本次会话有效 */
  }
}

function requestMyLocation(): void {
  const btn = document.getElementById("btn-locate") as HTMLButtonElement | null;
  if (!("geolocation" in navigator)) {
    if (btn) btn.textContent = "此浏览器不支持定位";
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = "定位中…";
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      saveMyLocation({ name: MY_LOCATION, lng: pos.coords.longitude, lat: pos.coords.latitude });
      refreshImpacts();
      tmap.focusCity(MY_LOCATION);
    },
    (err) => {
      if (!btn) return;
      btn.disabled = false;
      btn.textContent =
        err.code === err.PERMISSION_DENIED
          ? "定位被拒绝 · 点击重试（需在浏览器设置允许）"
          : "定位失败 · 点击重试";
    },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
  );
}

function cityFromUrl(): string | null {
  return new URLSearchParams(location.search).get("city");
}

function pickFocusImpact(impacts: CityImpact[]): CityImpact | undefined {
  // 我的位置优先：对灾区用户，"我这里"永远比任何城市重要
  const mine = impacts.find((x) => x.name === MY_LOCATION && x.status !== "watch");
  if (mine) return mine;
  const focus = cityFromUrl();
  if (focus) {
    const matched = impacts.find((x) => x.name === focus && x.status !== "watch");
    if (matched) return matched;
  }
  return impacts.find((x) => x.status === "inside") ?? impacts.find((x) => x.status === "incoming");
}

function posterData(incoming: CityImpact | undefined): PosterData | undefined {
  const last = data?.points[data.points.length - 1];
  if (!last) return undefined;
  return {
    typhoonNo: "2026 年第 9 号",
    nameCn: data?.name || "巴威",
    nameEn: data?.enName || "BAVI",
    speed: last.speed,
    pressure: last.pressure,
    power: last.power,
    strong: last.strong,
    focusCity: incoming?.name,
    focusEtaText:
      incoming?.status === "inside" ? "已进入影响范围" : incoming?.etaT ? formatEta(incoming.etaT) : undefined,
  };
}

function sharePayload(): SharePayload {
  // 分享链接只带公共城市：我的位置是私人坐标，不进入任何 URL
  const incoming = pickFocusImpact(latestImpacts.filter((x) => x.name !== MY_LOCATION));
  const city = incoming?.name;
  const url = city ? `https://chinaupdated.com/?city=${encodeURIComponent(city)}` : "https://chinaupdated.com/";
  let text = "台风巴威路径查询：对照官方预报路径看你的城市影响时间估算，提前做好准备（信息转自官方公开渠道）：";
  if (incoming?.status === "inside") {
    text = `据官方预报路径估算，台风巴威大风可能影响${city}，请以官方预警为准并转告亲友（信息转自官方公开渠道）：`;
  } else if (incoming?.status === "incoming" && incoming.etaT) {
    text = `据官方预报路径估算，${city}距大风影响约${formatEta(incoming.etaT)}（估算，非官方预警），请以官方预警为准并提前准备（信息转自官方公开渠道）：`;
  }
  return { title: "台风巴威路径查询 · 官方预报聚合", text, url, poster: posterData(incoming) };
}

function updateAlertBanner(impacts: CityImpact[]): void {
  let banner = document.getElementById("alert-banner");
  const target = pickFocusImpact(impacts);
  if (!target || target.status === "watch") {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "alert-banner";
    banner.setAttribute("role", "alert");
    document.body.appendChild(banner);
    banner.addEventListener("click", () => tmap.focusCity(target.name));
  }
  const small = isMobile();
  const msg =
    target.status === "inside"
      ? small
        ? `${target.name} · 或受大风影响`
        : `${target.name} · 或受大风影响 · 请以官方预警为准`
      : small
        ? `${target.name} · 约${formatEta(target.etaT!)}（估算）→`
        : `${target.name} · 距官方预报路径影响约 ${formatEta(target.etaT!)}（估算）· 点击看详情`;
  banner.textContent = msg;
  syncAlertBannerHost();
}

const playback = new PlaybackEngine({
  onFrame: (frame) => {
    if (!data) return;
    const state = tmap.stateAt(frame.currentTime);
    tmap.renderFrame(state, {
      time: frame.currentTime,
      progress: frame.progress,
      playing: frame.status === "playing",
      deltaMs: frame.deltaMs,
    });
    tmap.setForecastDim(frame.status === "playing");
    updateHud(state.time, state.speed, state.pressure, state.power, state.strong, state.moveDir, state.moveSpeed, state.lng, state.lat);
    ($("#scrubber") as HTMLInputElement).value = String(Math.round(frame.progress * 1000));
    $("#t-current").textContent = state.time.slice(5);
  },
  onPulse: (phase) => {
    if (!data) return;
    tmap.tickPulse(tmap.stateAt(playback.t), phase);
  },
  speed: 2,
});

/** ———— 数据获取 ———— */
async function fetchData(): Promise<TyphoonData> {
  if (import.meta.env.DEV) return createDevTyphoonData();

  const res = await fetch(`/api/typhoon/${TYPHOON_ID}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const body = (await res.json()) as TyphoonData & { error?: string };
  if (body.error) throw new Error(body.error);
  return body;
}

function applyData(d: TyphoonData, first: boolean): void {
  data = d;
  tmap.setData(d);
  const pts = d.points;
  playback.setRange(pts[0].t, pts[pts.length - 1].t);

  $("#t-start").textContent = pts[0].time.slice(5);
  $("#t-end").textContent = "现在";
  updateFreshness();
  $("#hud-foot").textContent = `来源：${d.source}`;

  renderAgencyList(d);
  refreshImpacts();

  if (first) {
    renderLegend();
    playback.seek(playback.t1);
    tmap.fitToData();
    // 手机 webview 首屏地址栏伸缩会改变视口，取景自愈保证台风完整入镜
    tmap.armFitSelfHeal();
    $("#loading").classList.add("hide");
    playback.start();
    const city = cityFromUrl();
    if (city) {
      setTimeout(() => tmap.focusCity(city), 1800);
      document.querySelectorAll<HTMLButtonElement>(".impact-row").forEach((row) => {
        row.classList.toggle("active", row.dataset.city === city);
      });
    }
  } else if (!playback.playing) {
    playback.seek(playback.t1);
  }
}

/** ———— HUD ———— */
function updateHud(
  time: string, speed: number, pressure: number, power: number | null,
  strong: string, moveDir: string | null, moveSpeed: number | null,
  lng: number, lat: number,
): void {
  const style = intensityOf(strong);
  const badge = $("#hud-badge");
  badge.textContent = strong || "—";
  badge.style.setProperty("--badge-color", style.color);
  $("#s-speed").textContent = String(Math.round(speed));
  $("#s-pressure").textContent = String(Math.round(pressure));
  $("#s-power").textContent = powerValue(power);
  $("#s-power-unit").textContent = powerUnit(power);
  const dir = plainMoveDir(moveDir);
  if (dir && moveSpeed != null) {
    $("#s-move").textContent = dir;
    $("#s-move-unit").textContent = `${Math.round(moveSpeed)} km/h`;
  } else if (dir) {
    $("#s-move").textContent = dir;
    $("#s-move-unit").textContent = "—";
  } else {
    $("#s-move").textContent = "—";
    $("#s-move-unit").textContent = "km/h";
  }
  $("#s-pos").textContent = `中心位置 ${lat.toFixed(1)}°N, ${lng.toFixed(1)}°E · ${time}`;
}

/** ———— 城市波及倒计时 ———— */
function refreshImpacts(): void {
  if (!data) return;
  const cities = myLocation ? [myLocation, ...CITIES] : CITIES;
  const impacts = computeImpacts(data, Date.now(), cities);
  latestImpacts = impacts;
  tmap.setImpacts(impacts);
  renderImpactList(impacts);
  updateAlertBanner(impacts);
  // 指南阶段跟随最紧迫的倒计时（我的位置优先）自动推进
  setGuideContext(pickFocusImpact(impacts) ?? null);
}

function renderImpactList(impacts: CityImpact[]): void {
  const box = $("#impact-list");
  const rows = impacts
    .map((im) => {
      const mine = im.name === MY_LOCATION;
      const value =
        im.status === "inside"
          ? `<b class="ci-inside">影响中</b>`
          : im.status === "incoming"
            ? `<b class="ci-incoming">${formatEta(im.etaT!)}</b>`
            : `<b class="ci-watch">${im.minDistKm} km</b>`;
      return `<button class="impact-row${mine ? " mine" : ""}" data-city="${im.name}">
        <i class="ci-dot ci-${im.status}"></i>
        <span class="impact-name">${im.name}</span>
        <span class="impact-value">${value}</span>
        ${mine ? `<span class="loc-clear" title="清除我的位置" role="button" aria-label="清除我的位置">×</span>` : ""}
      </button>`;
    })
    .join("");
  // 未定位时显示入口按钮；坐标只在本机计算，这句承诺必须让用户看见
  const locate = myLocation
    ? ""
    : `<button id="btn-locate" class="locate-btn">定位我的位置 · 算我这里的倒计时</button>
       <p class="locate-note">定位只在你的手机上计算，不会上传</p>`;
  box.innerHTML = locate + rows;

  document.getElementById("btn-locate")?.addEventListener("click", requestMyLocation);
  box.querySelectorAll<HTMLElement>(".loc-clear").forEach((x) => {
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      saveMyLocation(null);
      tmap.removeCityMarker(MY_LOCATION);
      refreshImpacts();
    });
  });
  box.querySelectorAll<HTMLButtonElement>(".impact-row").forEach((row) => {
    row.addEventListener("click", () => {
      const name = row.dataset.city!;
      // 我的位置不写入 URL：私人坐标不该出现在可复制的链接里
      if (name !== MY_LOCATION) history.replaceState(null, "", `?city=${encodeURIComponent(name)}`);
      document.querySelectorAll(".impact-row").forEach((r) => r.classList.remove("active"));
      row.classList.add("active");
      tmap.focusCity(name);
      updateAlertBanner(latestImpacts);
    });
  });
}

// 倒计时每分钟刷新一次显示
setInterval(refreshImpacts, 60_000);

function renderAgencyList(d: TyphoonData): void {
  const box = $("#agency-list");
  const existing = new Set(Array.from(box.querySelectorAll<HTMLElement>("[data-agency]")).map((el) => el.dataset.agency));
  for (const fc of d.forecasts) {
    if (existing.has(fc.agency) || fc.points.length === 0) continue;
    const lastQ = fc.points[fc.points.length - 1];
    const row = document.createElement("label");
    row.className = "agency-row";
    row.dataset.agency = fc.agency;
    row.innerHTML = `
      <input type="checkbox" checked />
      <i class="agency-dash" style="--ac:${agencyColor(fc.agency)}"></i>
      <span class="agency-name">${fc.agency}</span>
      <span class="agency-info">${fc.points.length} 个预报点 · 至 ${lastQ.time.slice(5, 11)}</span>`;
    row.querySelector("input")!.addEventListener("change", (e) => {
      tmap.toggleAgency(fc.agency, (e.target as HTMLInputElement).checked);
    });
    box.appendChild(row);
  }
}

function renderLegend(): void {
  $("#legend").innerHTML = INTENSITY_ORDER
    .map((name) => `<span class="legend-item"><i style="background:${intensityOf(name).color}"></i>${name}</span>`)
    .join("");
}

/** ———— UI 事件 ———— */
function wireControls(): void {
  $("#btn-play").addEventListener("click", () => playback.toggle());

  const scrubber = $("#scrubber") as HTMLInputElement;
  scrubber.addEventListener("input", () => {
    const ratio = Number(scrubber.value) / 1000;
    // 先读取用户输入再暂停；pause() 会同步回写当前帧，若顺序相反会把滑块重置到旧位置。
    playback.pause();
    playback.seek(playback.t0 + ratio * (playback.t1 - playback.t0));
  });

  document.querySelectorAll<HTMLButtonElement>(".speed-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".speed-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      playback.hoursPerSec = Number(btn.dataset.speed);
    });
  });

  const sceneToggle = $("#scene-controls-toggle") as HTMLButtonElement;
  const scenePanel = $("#scene-controls-panel");
  sceneToggle.addEventListener("click", () => {
    const open = scenePanel.hidden;
    scenePanel.hidden = !open;
    sceneToggle.setAttribute("aria-expanded", String(open));
  });

  document.querySelectorAll<HTMLInputElement>('input[name="camera-mode"]').forEach((control) => {
    control.addEventListener("change", () => {
      if (control.checked) tmap.setCameraMode(control.value as CameraMode);
    });
  });

  document.querySelectorAll<HTMLInputElement>("[data-scene-layer]").forEach((control) => {
    control.addEventListener("change", () => {
      const layer = control.dataset.sceneLayer as keyof LayerVisibility;
      tmap.setLayerVisibility({ [layer]: control.checked });
    });
  });

  const performanceSelect = $("#performance-tier");
  const performanceHint = $("#performance-hint");
  const updatePerformanceHint = (): void => {
    performanceHint.textContent = `当前：${tmap.getPerformanceTier() === "high" ? "高画质" : tmap.getPerformanceTier() === "balanced" ? "均衡" : "省电"}`;
  };
  updatePerformanceHint();
  performanceSelect.addEventListener("change", (event) => {
    const value = (event.currentTarget as unknown as { value: string }).value;
    const tier = value === "auto"
      ? (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "low" : "balanced")
      : value as PerformanceTier;
    tmap.setPerformanceTier(tier);
    updatePerformanceHint();
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      playback.toggle();
    }
  });

  // 右侧抽屉：Tab 切换（事件委托，兼容移动端动态新增的 Tab）与展开收起
  const drawer = $("#drawer");
  $(".drawer-tabs").addEventListener("click", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLButtonElement>(".drawer-tab");
    if (!tab || !tab.dataset.panel) return;
    document.querySelectorAll(".drawer-tab").forEach((t) => {
      t.classList.remove("active");
      t.setAttribute("aria-selected", "false");
    });
    document.querySelectorAll(".drawer-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
    document.getElementById(`panel-${tab.dataset.panel}`)?.classList.add("active");
  });
  $("#drawer-close").addEventListener("click", () => {
    drawer.classList.remove("open");
    document.body.classList.remove("drawer-open");
    if (window.innerWidth >= 1100) tmap.fitToData();
  });
  $("#drawer-open").addEventListener("click", () => {
    drawer.classList.add("open");
    document.body.classList.add("drawer-open");
    if (window.innerWidth >= 1100) tmap.fitToData();
  });

  // 左侧 HUD 折叠：把地图让给主视野，收起/展开都重新取景，让镜头真正用上空出来的空间。
  // HUD 在平板宽度(761–1099)也是侧栏布局（只有右侧抽屉在该宽度下变成底部弹层），
  // 所以这里按「非移动端」而非桌面专属的 1100 断点来判断，否则平板下折叠了却不会重新取景。
  const hud = $("#hud");
  $("#hud-close").addEventListener("click", () => {
    hud.classList.add("collapsed");
    document.body.classList.add("hud-collapsed");
    if (!isMobile()) tmap.fitToData();
  });
  $("#hud-open").addEventListener("click", () => {
    hud.classList.remove("collapsed");
    document.body.classList.remove("hud-collapsed");
    if (!isMobile()) tmap.fitToData();
  });

  // 转发扩散：二维码弹窗（含城市深链）
  $("#btn-share").addEventListener("click", () => {
    openShareModal(sharePayload());
  });

  // 一键直达"现在该做什么"：慌乱时刻的最短路径
  document.getElementById("btn-guide")?.addEventListener("click", () => openGuideModal());

  // 角落入口：聊聊初心
  document.getElementById("btn-origin")?.addEventListener("click", () => openOriginModal());
  initMusic();
}

/** ———— 数据新鲜度 ———— */
let lastFetchAt = 0;
let refreshTimer = 0;

function updateFreshness(): void {
  const stamp = document.getElementById("datastamp");
  if (!stamp || !data) return;
  const last = data.points[data.points.length - 1];
  const small = isMobile();
  let tail: string;
  let stale = false;
  if (!lastFetchAt) {
    tail = "";
  } else {
    const min = Math.floor((Date.now() - lastFetchAt) / 60000);
    stale = min >= 15;
    if (stale) tail = small ? " · ⚠ 可能滞后" : " · ⚠ 数据可能滞后，以官方预警为准";
    // 移动端空间紧张：用更短的措辞常驻显示，而不是完全不提示——
    // 不然用户没法判断这数据到底是不是刚更新的
    else if (small) tail = min < 1 ? " · 刚同步" : ` · ${min}分前`;
    else if (min < 1) tail = " · 刚刚同步";
    else tail = ` · ${min} 分钟前同步`;
  }
  stamp.classList.toggle("stale", stale);
  stamp.innerHTML = small
    ? `官方数据 · 截至 <b>${last.time.slice(5, 16)}</b>${data.active ? "" : " · 停编"}${tail}`
    : `中央气象台等官方数据 · 截至 <b>${last.time}</b>（北京时间）${data.active ? "" : " · 已停编"}${tail}`;
}

/** ———— 启动与自动刷新（失败退避重试） ———— */
async function refresh(first: boolean): Promise<void> {
  const d = await fetchData();
  lastFetchAt = Date.now();
  applyData(d, first);
}

function scheduleRefresh(ms: number): void {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(runRefresh, ms);
}

async function runRefresh(): Promise<void> {
  try {
    await refresh(false);
    scheduleRefresh(REFRESH_MS);
  } catch {
    // 失败不静默：30 秒退避重试一次，并刷新时效提示
    updateFreshness();
    scheduleRefresh(30_000);
  }
}

async function initialLoad(): Promise<void> {
  try {
    await refresh(true);
  } catch (err) {
    $("#loading").innerHTML =
      `<div class="spinner"></div><p class="err">数据获取失败：${(err as Error).message}<br/>10 秒后自动重试…</p>`;
    setTimeout(initialLoad, 10_000);
    return;
  }
  scheduleRefresh(REFRESH_MS);
}

/** ———— 离线可用 ———— */
// 开发环境绝不能被生产 SW 的缓存优先策略控制，否则 HMR/源码请求会长期命中旧版本。
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  const resetKey = "bavi:dev-sw-reset";
  void Promise.all([
    navigator.serviceWorker.getRegistrations().then((items) => Promise.all(items.map((item) => item.unregister()))),
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("bavi-")).map((key) => caches.delete(key)))),
  ]).then(() => {
    if (!navigator.serviceWorker.controller || sessionStorage.getItem(resetKey)) {
      sessionStorage.removeItem(resetKey);
      return;
    }
    sessionStorage.setItem(resetKey, "1");
    window.location.reload();
  });
// 台风天网络最不可靠，生产环境用 SW 缓存最近一次数据。
} else if ("serviceWorker" in navigator) {
  // 已有旧 SW 时记录下来：新版本 skipWaiting+claim 接管后自动刷新一次，
  // 让存量用户无需手动清缓存即可拿到最新修复（首次访问无旧 SW 则不刷新，避免无谓重载）。
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

function setOfflineBar(offline: boolean): void {
  let bar = document.getElementById("offline-bar");
  if (!offline) {
    bar?.remove();
    return;
  }
  if (bar) return;
  bar = document.createElement("div");
  bar.id = "offline-bar";
  bar.setAttribute("role", "status");
  bar.textContent = "当前离线 · 显示的是最近缓存数据，恢复联网后自动更新";
  document.body.appendChild(bar);
}

window.addEventListener("offline", () => {
  setOfflineBar(true);
  updateFreshness();
});
window.addEventListener("online", () => {
  setOfflineBar(false);
  runRefresh();
  refreshNews();
});
if (!navigator.onLine) setOfflineBar(true);

// 时效提示每 30 秒刷新一次
setInterval(updateFreshness, 30_000);

// 切回前台：数据超过 2 分钟立即刷新（手机切后台是常态）
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (lastFetchAt && Date.now() - lastFetchAt > 120_000) {
    runRefresh();
    refreshNews();
  }
});

wireControls();
renderGuide($("#panel-guide"));
initSlogans();
// 资讯面板延迟加载，优先渲染地图与台风数据
setTimeout(initNews, 2500);
// 官方发布区（已授权转载）优先于实时资讯露出
setTimeout(initOfficialFeed, 800);
// 布局编排：移动端合并为底部抽屉，桌面维持左右分栏
initMobile();
// 中屏（平板：761–1099）默认收起右侧抽屉，把地图让给主视野
if (window.innerWidth >= 761 && window.innerWidth < 1100) {
  $("#drawer").classList.remove("open");
  document.body.classList.remove("drawer-open");
}
tmap.onReady(() => {
  try {
    tmap.setupLayers();
  } catch (e) {
    // 图层初始化失败不该拖垮数据链路：地图可能显示不全，但倒计时、指南等核心信息必须还能用
    console.error("地图图层初始化失败，将仅展示数据面板", e);
  }
  initialLoad();
});
