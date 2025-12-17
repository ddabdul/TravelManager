import { airportCoords } from "./airportCoords.js";
import { getPassengerFlights } from "./flights.js";
import { normalizePassengerNames, normalizeFlightNumber } from "./utils.js";

export function createMapScreenController() {
  let mapInstance = null;
  let mapRoutesLayer = null;
  let mapAirportsLayer = null;
  let mapLabelsLayer = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        case '"': return "&quot;";
        case "'": return "&#39;";
        default: return ch;
      }
    });
  }

  function getMapNodeFromAirportCode(codeRaw, cityIndex) {
    const code = (codeRaw || "").toUpperCase().trim();
    if (!code) return null;
    const entry = airportCoords[code];
    if (!entry || typeof entry.lat !== "number" || typeof entry.lon !== "number") return null;

    const city = (entry.city || "").trim();
    if (!city) {
      return {
        key: code,
        city: code,
        lat: entry.lat,
        lon: entry.lon,
        airports: [{ code, name: entry.name || code }]
      };
    }

    const cityGroup = cityIndex.get(city);
    if (!cityGroup || !cityGroup.airports.length) {
      return {
        key: city,
        city,
        lat: entry.lat,
        lon: entry.lon,
        airports: [{ code, name: entry.name || code }]
      };
    }

    return {
      key: city,
      city,
      lat: cityGroup.lat,
      lon: cityGroup.lon,
      airports: cityGroup.airports.map((a) => ({ code: a.code, name: a.name }))
    };
  }

  function computeBearingDegrees(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const toDeg = (rad) => (rad * 180) / Math.PI;
    const phi1 = toRad(lat1);
    const phi2 = toRad(lat2);
    const dLambda = toRad(lon2 - lon1);
    const y = Math.sin(dLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
    const theta = Math.atan2(y, x);
    const bearing = (toDeg(theta) + 360) % 360;
    return Number.isFinite(bearing) ? bearing : 0;
  }

  function buildGreatCircleArcLatLngs(from, to, segments) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const toDeg = (rad) => (rad * 180) / Math.PI;

    const lat1 = toRad(from.lat);
    const lon1 = toRad(from.lon);
    const lat2 = toRad(to.lat);
    const lon2 = toRad(to.lon);

    const d = Math.acos(
      Math.sin(lat1) * Math.sin(lat2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
    );

    if (!Number.isFinite(d) || d === 0) {
      return [[from.lat, from.lon], [to.lat, to.lon]];
    }

    const steps = Math.max(2, Math.floor(segments || 24));
    const sinD = Math.sin(d);
    const points = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const A = Math.sin((1 - t) * d) / sinD;
      const B = Math.sin(t * d) / sinD;

      const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
      const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
      const z = A * Math.sin(lat1) + B * Math.sin(lat2);

      const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
      const lon = Math.atan2(y, x);
      points.push([toDeg(lat), toDeg(lon)]);
    }

    return points;
  }

  function estimateArcSegments(from, to) {
    if (!from || !to) return 24;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const lat1 = toRad(from.lat);
    const lon1 = toRad(from.lon);
    const lat2 = toRad(to.lat);
    const lon2 = toRad(to.lon);
    const d = Math.acos(
      Math.sin(lat1) * Math.sin(lat2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
    );
    if (!Number.isFinite(d) || d === 0) return 12;
    const deg = (d * 180) / Math.PI;
    return Math.max(12, Math.min(72, Math.ceil(deg / 3)));
  }

  function getProjectedPolylinePointAtFraction(pointsPx, fraction) {
    if (!Array.isArray(pointsPx) || pointsPx.length < 2) return null;
    const f = Math.max(0, Math.min(1, fraction));

    let total = 0;
    const lens = [];
    for (let i = 0; i < pointsPx.length - 1; i++) {
      const p0 = pointsPx[i];
      const p1 = pointsPx[i + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy) || 0;
      lens.push(len);
      total += len;
    }
    if (!total) return { point: pointsPx[0], dir: { x: 1, y: 0 } };

    const target = total * f;
    let acc = 0;
    for (let i = 0; i < lens.length; i++) {
      const seg = lens[i];
      const p0 = pointsPx[i];
      const p1 = pointsPx[i + 1];
      if (acc + seg >= target || i === lens.length - 1) {
        const t = seg ? (target - acc) / seg : 0;
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const point = window.L.point(p0.x + dx * t, p0.y + dy * t);
        const dlen = Math.hypot(dx, dy) || 1;
        const dir = { x: dx / dlen, y: dy / dlen };
        return { point, dir };
      }
      acc += seg;
    }

    return { point: pointsPx[pointsPx.length - 1], dir: { x: 1, y: 0 } };
  }

  function pad2(num) {
    return String(num).padStart(2, "0");
  }

  function localDateKey(dateObj) {
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return "";
    return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;
  }

  function flightDateKey(f) {
    if (f && typeof f.departureTime === "string" && f.departureTime.length >= 10) {
      return f.departureTime.slice(0, 10);
    }
    return localDateKey(f?.date);
  }

  function dedupeFlightsForMap(flights) {
    const seen = new Map();
    const unique = [];
    for (const f of flights) {
      const fn = normalizeFlightNumber(f?.flightNumber || "");
      const dep = (f?.departureCode || "").toUpperCase().trim();
      const arr = (f?.arrivalCode || "").toUpperCase().trim();
      const dateKey = flightDateKey(f);

      if (fn && dep && arr && dateKey) {
        const key = `${fn}__${dateKey}__${dep}__${arr}`;
        const existing = seen.get(key);
        if (existing) {
          const pax = Array.isArray(f.paxNames) ? f.paxNames : [];
          existing.paxNames = normalizePassengerNames([...(existing.paxNames || []), ...pax]);
          if (!existing.airline && f.airline) existing.airline = f.airline;
          if (!existing.departureName && f.departureName) existing.departureName = f.departureName;
          if (!existing.arrivalName && f.arrivalName) existing.arrivalName = f.arrivalName;
          if (!existing.departureTime && f.departureTime) existing.departureTime = f.departureTime;
          if (!existing.arrivalTime && f.arrivalTime) existing.arrivalTime = f.arrivalTime;
          continue;
        }
        const pax = Array.isArray(f.paxNames) ? f.paxNames : [];
        const base = { ...f, paxNames: normalizePassengerNames(pax) };
        seen.set(key, base);
        unique.push(base);
        continue;
      }

      unique.push(f);
    }
    return unique;
  }

  function buildCityIndexFromAirportCoords() {
    const cityIndex = new Map();
    for (const [code, entry] of Object.entries(airportCoords || {})) {
      const city = (entry && entry.city ? String(entry.city) : "").trim();
      if (!city) continue;
      if (typeof entry.lat !== "number" || typeof entry.lon !== "number") continue;
      let group = cityIndex.get(city);
      if (!group) {
        group = { city, airports: [], lat: 0, lon: 0 };
        cityIndex.set(city, group);
      }
      group.airports.push({ code, name: entry.name || code, lat: entry.lat, lon: entry.lon });
    }
    for (const group of cityIndex.values()) {
      const n = group.airports.length || 1;
      group.lat = group.airports.reduce((acc, a) => acc + a.lat, 0) / n;
      group.lon = group.airports.reduce((acc, a) => acc + a.lon, 0) / n;
    }
    return cityIndex;
  }

  function mapFlightToCityRoute(f, cityIndex) {
    const dep = getMapNodeFromAirportCode(f.departureCode, cityIndex);
    const arr = getMapNodeFromAirportCode(f.arrivalCode, cityIndex);
    if (!dep || !arr) return null;
    if (dep.key === arr.key) return null;

    const [aKey, bKey] = [dep.key, arr.key].sort((x, y) => x.localeCompare(y));
    const routeKey = `${aKey}__${bKey}`;
    const dir = dep.key === aKey ? "AB" : "BA";
    return { dep, arr, aKey, bKey, routeKey, dir };
  }

  function getPassengerNamesFromFlights(flights) {
    const set = new Set();
    for (const f of flights) {
      for (const name of (f.paxNames || [])) {
        const trimmed = String(name || "").trim();
        if (trimmed) set.add(trimmed);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  function renderMapControls({ trips, mapState, els }) {
    const passSelect = els["map-passenger"];
    const routeSelect = els["map-route"];
    const yearList = els["map-year-list"];
    if (!passSelect || !routeSelect || !yearList) return;

    const allFlightsRaw = getPassengerFlights(trips, null);
    const allFlights = dedupeFlightsForMap(allFlightsRaw);
    const cityIndex = buildCityIndexFromAirportCoords();

    // Years available for current passenger/route filters (across all years)
    const yearsSet = new Set();
    for (const f of allFlights) {
      if (mapState.passenger && !(f.paxNames || []).includes(mapState.passenger)) continue;
      const info = mapFlightToCityRoute(f, cityIndex);
      if (!info) continue;
      if (mapState.routeKey && info.routeKey !== mapState.routeKey) continue;
      yearsSet.add(f.date.getFullYear());
    }
    const years = Array.from(yearsSet).sort((a, b) => a - b);
    const currentYear = new Date().getFullYear();
    if (!years.length) {
      mapState.year = currentYear;
    } else if (!years.includes(mapState.year)) {
      mapState.year = years.includes(currentYear) ? currentYear : years[years.length - 1];
    }

    yearList.innerHTML = years.map((y) => {
      const active = y === mapState.year ? "active" : "";
      return `<button class="chip-button ${active}" data-year="${y}">${y}</button>`;
    }).join("");

    // Build mapped flights for the selected year (used to compute options)
    const mappedForYear = [];
    for (const f of allFlights) {
      if (f.date.getFullYear() !== mapState.year) continue;
      const info = mapFlightToCityRoute(f, cityIndex);
      if (!info) continue;
      mappedForYear.push({ flight: f, ...info });
    }

    // 1) Passenger options are derived from selected year + selected route (or all routes).
    const flightsForPassengerOptions = mapState.routeKey
      ? mappedForYear.filter((m) => m.routeKey === mapState.routeKey).map((m) => m.flight)
      : mappedForYear.map((m) => m.flight);
    const passengerOptions = getPassengerNamesFromFlights(flightsForPassengerOptions);
    if (mapState.passenger !== null && !passengerOptions.includes(mapState.passenger)) {
      mapState.passenger = null;
    }

    passSelect.innerHTML = '<option value="__all__">All passengers</option>';
    passengerOptions.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      passSelect.appendChild(opt);
    });
    passSelect.value = mapState.passenger === null ? "__all__" : mapState.passenger;

    // 2) Route options are derived from selected year + selected passenger (or all passengers).
    const mappedForRouteOptions = mapState.passenger
      ? mappedForYear.filter((m) => (m.flight.paxNames || []).includes(mapState.passenger))
      : mappedForYear;

    const routesMap = new Map();
    for (const m of mappedForRouteOptions) {
      const entry = routesMap.get(m.routeKey) || { routeKey: m.routeKey, aKey: m.aKey, bKey: m.bKey, total: 0 };
      entry.total += 1;
      routesMap.set(m.routeKey, entry);
    }

    const routes = Array.from(routesMap.values()).sort((a, b) => b.total - a.total || a.routeKey.localeCompare(b.routeKey));
    const validRouteKeys = new Set(routes.map((r) => r.routeKey));
    if (mapState.routeKey !== null && !validRouteKeys.has(mapState.routeKey)) {
      mapState.routeKey = null;
    }

    routeSelect.innerHTML = '<option value="__all__">All routes</option>';
    routes.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.routeKey;
      opt.textContent = `${r.aKey} <-> ${r.bKey} (${r.total})`;
      routeSelect.appendChild(opt);
    });
    routeSelect.value = mapState.routeKey === null ? "__all__" : mapState.routeKey;

    // 3) Re-sync passengers after potentially resetting routeKey.
    const flightsForPassengerOptions2 = mapState.routeKey
      ? mappedForYear.filter((m) => m.routeKey === mapState.routeKey).map((m) => m.flight)
      : mappedForYear.map((m) => m.flight);
    const passengerOptions2 = getPassengerNamesFromFlights(flightsForPassengerOptions2);
    if (mapState.passenger !== null && !passengerOptions2.includes(mapState.passenger)) {
      mapState.passenger = null;
    }
    passSelect.innerHTML = '<option value="__all__">All passengers</option>';
    passengerOptions2.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      passSelect.appendChild(opt);
    });
    passSelect.value = mapState.passenger === null ? "__all__" : mapState.passenger;
  }

  function ensureMapInitialized(els) {
    const mapEl = els["map-canvas"];
    if (!mapEl) return false;

    if (mapInstance) {
      if (!mapRoutesLayer && window.L) mapRoutesLayer = window.L.layerGroup().addTo(mapInstance);
      if (!mapAirportsLayer && window.L) mapAirportsLayer = window.L.layerGroup().addTo(mapInstance);
      if (!mapLabelsLayer && window.L) mapLabelsLayer = window.L.layerGroup().addTo(mapInstance);
      return true;
    }

    if (!window.L || typeof window.L.map !== "function") {
      return false;
    }

    mapInstance = window.L.map(mapEl, { zoomControl: true });
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(mapInstance);

    const routesPane = mapInstance.createPane("routesPane");
    routesPane.style.zIndex = 300;
    const airportsPane = mapInstance.createPane("airportsPane");
    airportsPane.style.zIndex = 450;
    const labelsPane = mapInstance.createPane("labelsPane");
    labelsPane.style.zIndex = 500;

    mapRoutesLayer = window.L.layerGroup().addTo(mapInstance);
    mapAirportsLayer = window.L.layerGroup().addTo(mapInstance);
    mapLabelsLayer = window.L.layerGroup().addTo(mapInstance);

    mapInstance.setView([20, 0], 2);
    return true;
  }

  function renderMapFlights({ trips, mapState, els }) {
    const emptyEl = els["map-empty"];
    const warnEl = els["map-warning"];
    const mapEl = els["map-canvas"];
    if (!emptyEl || !warnEl || !mapEl) return;

    const hasLeaflet = ensureMapInitialized(els);
    if (!hasLeaflet) {
      emptyEl.textContent = "Map library not loaded. Check your internet connection or Leaflet import.";
      emptyEl.classList.remove("hidden");
      mapEl.classList.add("hidden");
      warnEl.classList.add("hidden");
      warnEl.textContent = "";
      return;
    }

    const allFlightsRaw = getPassengerFlights(trips, null);
    const yearFlightsRaw = allFlightsRaw.filter((f) => f.date.getFullYear() === mapState.year);
    const yearFlights = dedupeFlightsForMap(yearFlightsRaw);

    const filtered = mapState.passenger
      ? yearFlights.filter((f) => (f.paxNames || []).includes(mapState.passenger))
      : yearFlights;

    mapRoutesLayer.clearLayers();
    mapAirportsLayer.clearLayers();
    mapLabelsLayer.clearLayers();

    if (!filtered.length) {
      emptyEl.textContent = "No flights for this selection.";
      emptyEl.classList.remove("hidden");
      mapEl.classList.add("hidden");
      warnEl.classList.add("hidden");
      warnEl.textContent = "";
      mapInstance.setView([20, 0], 2);
      return;
    }

    const cityIndex = buildCityIndexFromAirportCoords();

    const nodesUsed = new Map();
    const missingCodes = new Set();
    const boundsPoints = [];
    let mappedFlightsCount = 0;
    let skippedMissingCoordsCount = 0;
    let skippedSameCityCount = 0;

    const routesMap = new Map();
    for (const f of filtered) {
      const dep = getMapNodeFromAirportCode(f.departureCode, cityIndex);
      const arr = getMapNodeFromAirportCode(f.arrivalCode, cityIndex);
      if (!dep) missingCodes.add((f.departureCode || "").toUpperCase() || "Unknown departure");
      if (!arr) missingCodes.add((f.arrivalCode || "").toUpperCase() || "Unknown arrival");
      if (!dep || !arr) {
        skippedMissingCoordsCount += 1;
        continue;
      }

      if (dep.key === arr.key) {
        skippedSameCityCount += 1;
        continue;
      }

      const [aKey, bKey] = [dep.key, arr.key].sort((x, y) => x.localeCompare(y));
      const routeKey = `${aKey}__${bKey}`;
      if (mapState.routeKey && routeKey !== mapState.routeKey) continue;

      nodesUsed.set(dep.key, dep);
      nodesUsed.set(arr.key, arr);
      mappedFlightsCount += 1;

      let bucket = routesMap.get(routeKey);
      if (!bucket) {
        bucket = { aKey, bKey, a: null, b: null, flightsAB: [], flightsBA: [] };
        routesMap.set(routeKey, bucket);
      }

      const nodeA = dep.key === aKey ? dep : arr;
      const nodeB = dep.key === aKey ? arr : dep;
      if (!bucket.a) bucket.a = nodeA;
      if (!bucket.b) bucket.b = nodeB;

      if (dep.key === aKey) bucket.flightsAB.push(f);
      else bucket.flightsBA.push(f);
    }

    const routeBuckets = Array.from(routesMap.values());
    routeBuckets.sort((a, b) => {
      const ta = a.flightsAB.length + a.flightsBA.length;
      const tb = b.flightsAB.length + b.flightsBA.length;
      return tb - ta;
    });

    // Show container before fitting (Leaflet needs a measurable size)
    emptyEl.classList.add("hidden");
    mapEl.classList.remove("hidden");
    mapInstance.invalidateSize();

    for (const route of routeBuckets) {
      if (!route.a || !route.b) continue;
      boundsPoints.push([route.a.lat, route.a.lon], [route.b.lat, route.b.lon]);
    }

    if (boundsPoints.length) {
      const bounds = window.L.latLngBounds(boundsPoints);
      mapInstance.fitBounds(bounds, { padding: [18, 18] });
    }

    const buildFlightsList = (flights) => {
      const list = (flights || [])
        .slice()
        .sort((x, y) => x.date - y.date)
        .slice(0, 8)
        .map((f) => {
          const dt = f.date
            ? f.date.toLocaleDateString()
            : (f.departureTime ? new Date(f.departureTime).toLocaleDateString() : "");
          const fn = (f.flightNumber || "").trim();
          const airline = (f.airline || "").trim();
          const label = [airline, fn].filter(Boolean).join(" ").trim() || "Flight";
          const dateHtml = dt ? ` &ndash; ${escapeHtml(dt)}` : "";
          return `<div style="margin-top:4px;"><span style="font-weight:600;">${escapeHtml(label)}</span>${dateHtml}</div>`;
        })
        .join("");

      return {
        list,
        moreCount: (flights || []).length > 8 ? (flights || []).length - 8 : 0
      };
    };

    const buildUniquePax = (flights) => Array.from(
      new Set((flights || []).flatMap((f) => (Array.isArray(f.paxNames) ? f.paxNames : [])))
    ).sort((x, y) => x.localeCompare(y));

    const buildPopupHtml = ({ depCity, arrCity, flights, countsHtml }) => {
      const count = (flights || []).length;
      const uniquePax = buildUniquePax(flights);
      const { list, moreCount } = buildFlightsList(flights);

      return `
        <div style="min-width:200px; max-width:260px; line-height:1.35; word-break:break-word;">
          <div style="font-weight:800;">${escapeHtml(depCity)} &rarr; ${escapeHtml(arrCity)}</div>
          <div style="margin-top:4px;">${count} flight${count === 1 ? "" : "s"}</div>
          ${countsHtml ? `<div style="margin-top:6px; color:#6b7280; font-size:12px;">${countsHtml}</div>` : ""}
          ${uniquePax.length ? `<div style="margin-top:8px;"><b>Pax:</b> ${escapeHtml(uniquePax.join(", "))}</div>` : ""}
          ${list ? `<div style="margin-top:10px;">${list}</div>` : ""}
          ${moreCount ? `<div style="margin-top:6px; color: #6b7280;">+${moreCount} more</div>` : ""}
        </div>
      `;
    };

    for (const route of routeBuckets) {
      const dep = route.a;
      const arr = route.b;
      if (!dep || !arr) continue;

      const countAB = route.flightsAB.length;
      const countBA = route.flightsBA.length;
      const total = countAB + countBA;
      if (!total) continue;

      const allFlightsForPair = route.flightsAB.concat(route.flightsBA);
      const popupAll = buildPopupHtml({
        depCity: dep.city,
        arrCity: arr.city,
        flights: allFlightsForPair,
        countsHtml:
          escapeHtml(dep.city) +
          " &rarr; " +
          escapeHtml(arr.city) +
          ": <b>" +
          countAB +
          "</b> &nbsp;&nbsp;|&nbsp;&nbsp; " +
          escapeHtml(arr.city) +
          " &rarr; " +
          escapeHtml(dep.city) +
          ": <b>" +
          countBA +
          "</b>"
      });
      const popupForward = buildPopupHtml({
        depCity: dep.city,
        arrCity: arr.city,
        flights: route.flightsAB
      });
      const popupBack = buildPopupHtml({
        depCity: arr.city,
        arrCity: dep.city,
        flights: route.flightsBA
      });
      const weight = Math.min(9, 3 + Math.log2(total + 1));
      const arc = buildGreatCircleArcLatLngs(dep, arr, estimateArcSegments(dep, arr));
      window.L.polyline(
        arc,
        { color: "#D32F2F", weight, opacity: 0.75, pane: "routesPane" }
      ).bindPopup(popupAll).addTo(mapRoutesLayer);

      const bearing = computeBearingDegrees(dep.lat, dep.lon, arr.lat, arr.lon);
      const rotAB = Math.round(bearing);
      const rotBA = Math.round((bearing + 180) % 360);
      const arrowRotation = rotAB;

      const [aKey, bKey] = [dep.key, arr.key].sort((x, y) => x.localeCompare(y));
      const sign = dep.key === aKey ? 1 : -1;
      const offsetPx = 12;
      const zoom = mapInstance.getZoom();
      const arcPx = arc.map((ll) => mapInstance.project(window.L.latLng(ll[0], ll[1]), zoom));

      const tAB = 1 / 3;
      const tBA = 2 / 3;
      const pAB = getProjectedPolylinePointAtFraction(arcPx, tAB);
      const pBA = getProjectedPolylinePointAtFraction(arcPx, tBA);
      if (!pAB || !pBA) continue;

      const nxAB = (-pAB.dir.y) * offsetPx * sign;
      const nyAB = (pAB.dir.x) * offsetPx * sign;
      const nxBA = (-pBA.dir.y) * offsetPx * sign;
      const nyBA = (pBA.dir.x) * offsetPx * sign;

      const labelLatLng = mapInstance.unproject(window.L.point(pAB.point.x + nxAB, pAB.point.y + nyAB), zoom);
      const labelLatLngBA = mapInstance.unproject(window.L.point(pBA.point.x - nxBA, pBA.point.y - nyBA), zoom);

      const planeRotationAdj = (deg) => deg - 90;
      const labelHtml = `
        <div class="route-count-badge">
          <div class="route-count-num">${countAB}</div>
          <div class="route-count-arrow" style="transform: rotate(${planeRotationAdj(arrowRotation)}deg);">&#9992;</div>
        </div>
      `;

      if (countAB) {
        const labelHtmlForward = `
          <div class="route-count-badge">
            <div class="route-count-num">${countAB}</div>
            <div class="route-count-arrow" style="transform: rotate(${planeRotationAdj(rotAB)}deg);">&#9992;</div>
          </div>
        `;
        if (mapState.showBadges) {
          window.L.marker(labelLatLng, {
            pane: "labelsPane",
            zIndexOffset: countAB,
            icon: window.L.divIcon({
              className: "route-count-icon",
              html: labelHtmlForward,
              iconSize: [44, 44],
              iconAnchor: [22, 22]
            })
          })
            .bindPopup(popupForward)
            .addTo(mapLabelsLayer);
        }
      }

      if (countBA) {
        const labelHtmlBack = `
          <div class="route-count-badge">
            <div class="route-count-num">${countBA}</div>
            <div class="route-count-arrow" style="transform: rotate(${planeRotationAdj(rotBA)}deg);">&#9992;</div>
          </div>
        `;
        if (mapState.showBadges) {
          window.L.marker(labelLatLngBA, {
            pane: "labelsPane",
            zIndexOffset: countBA,
            icon: window.L.divIcon({
              className: "route-count-icon",
              html: labelHtmlBack,
              iconSize: [44, 44],
              iconAnchor: [22, 22]
            })
          })
            .bindPopup(popupBack)
            .addTo(mapLabelsLayer);
        }
      }
    }

    for (const node of nodesUsed.values()) {
      const airportCodes = (node.airports || []).map((a) => a.code).filter(Boolean).sort();
      const airportLine = airportCodes.length ? `<div style="margin-top:6px; color:#6b7280;">${escapeHtml(airportCodes.join(", "))}</div>` : "";

      window.L.circleMarker([node.lat, node.lon], {
        pane: "airportsPane",
        radius: 6,
        color: "#1A237E",
        weight: 1,
        fillColor: "#1A237E",
        fillOpacity: 0.9
      })
        .bindPopup(`<b>${escapeHtml(node.city)}</b>${airportLine}`)
        .addTo(mapAirportsLayer);
    }

    if (missingCodes.size) {
      warnEl.classList.remove("hidden");
      const shownText = mapState.routeKey
        ? `Showing ${mappedFlightsCount} flight${mappedFlightsCount === 1 ? "" : "s"} on the map for the selected route. `
        : `Showing ${mappedFlightsCount} of ${filtered.length} flights on the map. `;
      warnEl.textContent =
        shownText +
        "Missing coordinates for: " +
        Array.from(missingCodes).filter(Boolean).sort().join(", ") +
        ". Add them in js/airportCoords.js to display those legs.";
    } else {
      const skipped = skippedMissingCoordsCount + skippedSameCityCount;
      if (skipped > 0) {
        warnEl.classList.remove("hidden");
        const shownText = mapState.routeKey
          ? `Showing ${mappedFlightsCount} flight${mappedFlightsCount === 1 ? "" : "s"} on the map for the selected route. `
          : `Showing ${mappedFlightsCount} of ${filtered.length} flights on the map. `;
        warnEl.textContent =
          shownText +
          (skippedSameCityCount ? `${skippedSameCityCount} within the same city were skipped. ` : "") +
          (skippedMissingCoordsCount ? `${skippedMissingCoordsCount} missing coordinates were skipped.` : "");
      } else {
        warnEl.classList.add("hidden");
        warnEl.textContent = "";
      }
    }

    if (!routeBuckets.length) {
      emptyEl.textContent = "No mappable flights for this selection (missing airport coordinates).";
      emptyEl.classList.remove("hidden");
      mapEl.classList.add("hidden");
      mapInstance.setView([20, 0], 2);
      return;
    }
    setTimeout(() => mapInstance && mapInstance.invalidateSize(), 0);
  }

  function renderMapScreen({ trips, mapState, els }) {
    renderMapControls({ trips, mapState, els });
    renderMapFlights({ trips, mapState, els });
    syncMapActionButtons({ mapState, els });
  }

  function setMapFullscreen({ on, mapState, els }) {
    mapState.fullscreen = !!on;
    document.body.classList.toggle("map-fullscreen", mapState.fullscreen);
    syncMapActionButtons({ mapState, els });
    if (mapInstance) {
      setTimeout(() => mapInstance.invalidateSize(), 0);
    }
  }

  function syncMapActionButtons({ mapState, els }) {
    const fsBtn = els["map-fullscreen-btn"];
    const badgesBtn = els["map-badges-btn"];
    if (fsBtn) {
      fsBtn.textContent = mapState.fullscreen ? "Exit full screen" : "Full screen";
    }
    if (badgesBtn) {
      badgesBtn.textContent = mapState.showBadges ? "Hide badges" : "Show badges";
      badgesBtn.setAttribute("aria-pressed", mapState.showBadges ? "true" : "false");
    }
  }

  return {
    renderMapControls,
    renderMapFlights,
    renderMapScreen,
    setMapFullscreen,
    syncMapActionButtons
  };
}
