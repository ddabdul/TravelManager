// =========================
// Main App Entry Point
// =========================

import { loadTrips, saveTrips } from "./storage.js";
import { loadApiKey, fetchRoute } from "./api.js";
import { apiState } from "./config.js";
import { 
  normalizePassengerNames, 
  normalizeFlightNumber, 
  isValidFlightNumber, 
  cloneRouteWithDate, 
  generateHotelId,
  formatShortDate,
  formatDateTimeLocal,
  extractTime
} from "./utils.js";
import { findCachedRoute, getAllPassengers } from "./data.js";
import {
  renderTripsJson,
  renderTripSelect,
  renderPassengerSelect,
  renderHotelSelect,
  renderTripEvents
} from "./render.js";
import { calculateDaysByCountry, getPassengerYears } from "./daycount.js";
import { getPassengerFlights, getUpcomingFlights } from "./flights.js";
import { airportCoords } from "./airportCoords.js";

// -- Globals --
let trips = [];
let activeTripId = null;
let topbarMenuOpen = false;
let lastIsMobile = null;
let currentScreen = "trips";
let daycountState = { passenger: "", year: new Date().getFullYear() };
let upcomingState = { passenger: "" };
let mapState = { passenger: null, routeKey: null, year: new Date().getFullYear() };

let mapInstance = null;
let mapRoutesLayer = null;
let mapAirportsLayer = null;
let mapLabelsLayer = null;

// -- DOM Elements (cached for use in event listeners) --
const els = {};

function cacheElements() {
  const ids = [
    "trip-existing", "trip-new-name", "trip-error", "trip-events-list",
    "trip-events-summary", "add-flight-btn", "flight-overlay",
    "close-flight-overlay", "cancel-flight-btn", "add-hotel-btn", "hotel-overlay",
    "close-hotel-overlay", "cancel-hotel-btn", "flight-form", "output",
    "flight-number", "flight-date", "pax-existing", "pax-new", "pnr",
    "flight-error", "flight-date-error", "pax-error", "manual-route-section",
    "manual-route-error", "manual-airline", "manual-flight-number", 
    "manual-dep-airport", "manual-dep-iata", "manual-dep-time", 
    "manual-arr-airport", "manual-arr-iata", "manual-arr-time", 
    "hotel-form", "hotel-existing", "hotel-name", "hotel-pax", 
    "hotel-checkin", "hotel-checkout", "hotel-payment", "hotel-id",
    "hotel-name-error", "hotel-pax-error", "hotel-dates-error",
    "import-json", "import-json-file", "download-json", "clear-json",
    "api-key-status", "storage-usage",
    "api-key-status-menu", "storage-usage-menu",
    "topbar-menu-btn", "topbar-menu-panel",
    "config-upload-btn", "config-upload-file",
    // Daycount view
    "daycount-passenger", "daycount-year-list", "daycount-results", "daycount-empty",
    "daycount-upcoming-empty", "daycount-upcoming-list",
    "upcoming-passenger",
    // Upcoming flights screen
    "upcoming-empty", "upcoming-list",
    // Map screen
    "map-passenger", "map-route", "map-year-list", "map-empty", "map-warning", "map-canvas",
    // Screen switching
    "screen-trips", "screen-daycount", "screen-upcoming", "screen-map",
    // Nav buttons
    "nav-trips", "nav-daycount", "nav-upcoming", "nav-map",
    // All trips statistics card
    "trip-stats-container", "trip-pax-container", "trip-details-empty",
    // Trip selector layout containers
    "trip-fields", "trip-existing-field", "trip-new-field",
    // Mobile toggle button
    "toggle-alltrips-btn"
  ];
  ids.forEach(id => els[id] = document.getElementById(id));
  els.flightSubmitBtn = els["flight-form"]?.querySelector('button[type="submit"]');
  els.hotelSubmitBtn = els["hotel-form"]?.querySelector('button[type="submit"]');
}

let manualRouteMode = false;
let editingFlightId = null;
let importedRoutePreview = null;
let importNoticeShown = false;

// ------------------------------------------------------------------
// Trip selector UI helper
// - Show new-trip input only when __new__ selected
// - Expand dropdown to full width otherwise
// ------------------------------------------------------------------

function updateTripNewFieldVisibility() {
  const selectVal = els["trip-existing"]?.value;
  const isNew = !selectVal || selectVal === "__new__";

  const fieldsWrap = els["trip-fields"];
  const newField = els["trip-new-field"];

  if (!fieldsWrap || !newField) return;

  if (isNew) {
    newField.classList.remove("hidden");
    fieldsWrap.classList.remove("trip-only-select");
  } else {
    newField.classList.add("hidden");
    fieldsWrap.classList.add("trip-only-select");
    if (els["trip-new-name"]) els["trip-new-name"].value = "";
  }
}

// ------------------------------------------------------------------
// Mobile toggle for “All Trips Statistics” card
// Requires CSS: .card-trip-details {display:none on mobile}
// and .card-trip-details.is-expanded {display:block}
// ------------------------------------------------------------------

function isMobileView() {
  return window.matchMedia("(max-width: 720px)").matches;
}

function syncAllTripsToggle() {
  const btn = els["toggle-alltrips-btn"];
  const card = document.querySelector(".card-trip-details");
  if (!btn || !card) return;

  const mobile = isMobileView();

  if (!mobile) {
    // Desktop: always show card, hide button
    card.classList.remove("is-expanded");
    card.style.display = "";
    btn.style.display = "none";
    btn.setAttribute("aria-expanded", "true");
    return;
  }

  // Mobile: show button, card based on is-expanded
  btn.style.display = "inline-flex";
  const expanded = card.classList.contains("is-expanded");
  btn.setAttribute("aria-expanded", expanded ? "true" : "false");
  btn.textContent = expanded
    ? "Hide all trips statistics"
    : "Show all trips statistics";
  card.style.display = expanded ? "block" : "none";
}

function handleResponsiveResize() {
  const nowMobile = isMobileView();
  if (lastIsMobile === null) lastIsMobile = nowMobile;
  if (nowMobile !== lastIsMobile) {
    lastIsMobile = nowMobile;
    renderAll();
  }
  syncAllTripsToggle();
}

function setFlightOverlayMode(mode) {
  const titleEl = document.querySelector("#flight-overlay .card-title");
  const subtitleEl = document.querySelector("#flight-overlay .card-subtitle");
  const labelSpan = els.flightSubmitBtn?.querySelector("span:last-child");
  if (mode === "edit") {
    if (titleEl) titleEl.textContent = "Edit Flight";
    if (subtitleEl) subtitleEl.textContent = "Update flight details";
    if (labelSpan) labelSpan.textContent = "Update flight";
  } else {
    if (titleEl) titleEl.textContent = "Add Flight";
    if (subtitleEl) subtitleEl.textContent = "Enter flight details";
    if (labelSpan) labelSpan.textContent = "Save flight";
  }
}

function resetFlightOverlayState() {
  editingFlightId = null;
  manualRouteMode = false;
  importedRoutePreview = null;
  importNoticeShown = false;
  els["manual-route-section"]?.classList.add("hidden");
  els["flight-form"]?.reset();
  if (els["output"]) els["output"].textContent = "{}";
  setFlightOverlayMode("add");
}

function getIsoDateParts(iso) {
  if (!iso || typeof iso !== "string" || !iso.includes("T")) {
    return { date: "", time: "" };
  }
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function showImportedRouteForReview(route, flightDate) {
  if (!route) return;
  importedRoutePreview = cloneRouteWithDate(route, flightDate);
  manualRouteMode = true;

  const dep = importedRoutePreview?.departure || {};
  const arr = importedRoutePreview?.arrival || {};
  const depParts = getIsoDateParts(dep.scheduled || "");
  const arrParts = getIsoDateParts(arr.scheduled || "");
  const dateValue = flightDate || depParts.date || "";

  els["manual-route-section"]?.classList.remove("hidden");

  const normalizedFn = normalizeFlightNumber(importedRoutePreview.flightNumber || "");
  if (els["flight-number"] && !els["flight-number"].value) {
    els["flight-number"].value = normalizedFn;
  }
  if (els["manual-flight-number"]) els["manual-flight-number"].value = normalizedFn;
  if (els["manual-airline"]) els["manual-airline"].value = importedRoutePreview.airline || "";

  if (els["flight-date"] && dateValue) els["flight-date"].value = dateValue;

  if (els["manual-dep-airport"]) {
    els["manual-dep-airport"].value = dep.airport || dep.city || dep.name || dep.iata || dep.icao || "";
  }
  if (els["manual-dep-iata"]) {
    els["manual-dep-iata"].value = (dep.iata || dep.icao || "").toUpperCase();
  }
  if (els["manual-dep-time"]) els["manual-dep-time"].value = depParts.time || "";

  if (els["manual-arr-airport"]) {
    els["manual-arr-airport"].value = arr.airport || arr.city || arr.name || arr.iata || arr.icao || "";
  }
  if (els["manual-arr-iata"]) {
    els["manual-arr-iata"].value = (arr.iata || arr.icao || "").toUpperCase();
  }
  if (els["manual-arr-time"]) els["manual-arr-time"].value = arrParts.time || "";

  if (els["output"]) {
    const depLabel = dep.airport || dep.city || dep.name || dep.iata || dep.icao || "Unknown departure";
    const arrLabel = arr.airport || arr.city || arr.name || arr.iata || arr.icao || "Unknown arrival";
    const previewText = [
      "Imported flight details. Review and adjust before saving:",
      `Flight: ${(importedRoutePreview.airline || "").trim()} ${normalizedFn}`.trim(),
      dateValue ? `Date: ${formatShortDate(dateValue)} (${dateValue})` : "",
      `From: ${depLabel}${dep.iata || dep.icao ? ` (${dep.iata || dep.icao})` : ""} at ${depParts.time || "??:??"}`,
      `To: ${arrLabel}${arr.iata || arr.icao ? ` (${arr.iata || arr.icao})` : ""} at ${arrParts.time || "??:??"}`,
      "",
      "Update time/date below if they differ, then press Save flight."
    ].filter(Boolean).join("\n");
    els["output"].textContent = previewText;
  }

  if (!importNoticeShown) {
    alert("Flight imported. Review time/date below and press Save flight to confirm.");
    importNoticeShown = true;
  }

  validateFlightFormState();
}

function startEditFlight(record) {
  if (!record) return;
  editingFlightId = record.id;
  manualRouteMode = true;
  importedRoutePreview = null;
  setFlightOverlayMode("edit");

  const route = record.route || {};
  const dep = route.departure || {};
  const arr = route.arrival || {};
  const depIso = dep.scheduled || record.flightDate || "";
  const arrIso = arr.scheduled || "";
  const depDate = depIso ? depIso.slice(0, 10) : "";
  const depTime = depIso.includes("T") ? depIso.slice(11, 16) : "";
  const arrTime = arrIso.includes("T") ? arrIso.slice(11, 16) : "";

  els["flight-number"].value = route.flightNumber || record.flightNumber || "";
  els["flight-date"].value = depDate || record.flightDate || "";
  els["pnr"].value = record.pnr || "";

  const passengers = normalizePassengerNames(record.paxNames || []);
  const paxSelect = els["pax-existing"];
  if (paxSelect) {
    Array.from(paxSelect.options || []).forEach((opt) => {
      opt.selected = passengers.includes(opt.value);
    });
  }
  if (els["pax-new"]) els["pax-new"].value = "";

  els["manual-airline"].value = route.airline || "";
  els["manual-flight-number"].value = route.flightNumber || record.flightNumber || "";
  els["manual-dep-airport"].value = dep.airport || dep.city || dep.name || dep.iata || dep.icao || "";
  els["manual-dep-iata"].value = dep.iata || dep.icao || "";
  els["manual-dep-time"].value = depTime || "";
  els["manual-arr-airport"].value = arr.airport || arr.city || arr.name || arr.iata || arr.icao || "";
  els["manual-arr-iata"].value = arr.iata || arr.icao || "";
  els["manual-arr-time"].value = arrTime || "";

  els["manual-route-section"]?.classList.remove("hidden");
  els["flight-overlay"]?.classList.remove("hidden");
  validateFlightFormState();
}

function setStatusText(id, text) {
  const el = els[id];
  if (el) el.textContent = text;
  const menuEl = els[`${id}-menu`];
  if (menuEl) menuEl.textContent = text;
}

function setConfigUploadVisibility(show) {
  const btn = els["config-upload-btn"];
  if (!btn) return;
  btn.classList.remove("hidden");
}

function setTopbarMenuOpen(open) {
  const btn = els["topbar-menu-btn"];
  const panel = els["topbar-menu-panel"];
  topbarMenuOpen = !!open;
  if (!btn || !panel) return;
  panel.classList.toggle("hidden", !open);
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

// Screen switching (trips / daycount)
const monthLabels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function switchScreen(screen) {
  currentScreen =
    screen === "daycount"
      ? "daycount"
      : screen === "upcoming"
        ? "upcoming"
        : screen === "map"
          ? "map"
          : "trips";
  document.querySelectorAll(".screen").forEach((s) => {
    const active = s.id === `screen-${currentScreen}`;
    s.classList.toggle("active-screen", active);
    s.style.display = active ? "" : "none";
  });
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.screen === currentScreen);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.screen === currentScreen);
  });
  if (currentScreen === "daycount") {
    renderDaycountView();
  } else if (currentScreen === "upcoming") {
    renderUpcomingScreen();
  } else if (currentScreen === "map") {
    renderMapScreen();
  }
}

function renderDaycountView() {
  const passSelect = els["daycount-passenger"];
  const yearList = els["daycount-year-list"];
  const resultsEl = els["daycount-results"];
  const emptyEl = els["daycount-empty"];
  const upcomingList = els["daycount-upcoming-list"];
  const upcomingEmpty = els["daycount-upcoming-empty"];
  if (!passSelect || !yearList || !resultsEl || !emptyEl) return;

  const passengers = getAllPassengers(trips);
  passSelect.innerHTML = '<option value="">Select passenger</option>';
  passengers.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    if (p === daycountState.passenger) opt.selected = true;
    passSelect.appendChild(opt);
  });

  if (!passengers.includes(daycountState.passenger)) {
    daycountState.passenger = "";
  }

  if (!daycountState.passenger) {
    emptyEl.textContent = passengers.length ? "Choose a passenger to view days by country." : "No passengers yet.";
    emptyEl.classList.remove("hidden");
    resultsEl.innerHTML = "";
    yearList.innerHTML = "";
    return;
  }

  const years = getPassengerYears(trips, daycountState.passenger);
  if (!years.length) {
    emptyEl.textContent = "No travel data for this passenger.";
    emptyEl.classList.remove("hidden");
    resultsEl.innerHTML = "";
    yearList.innerHTML = "";
    return;
  }

  if (!years.includes(daycountState.year)) {
    daycountState.year = years[0];
  }

  yearList.innerHTML = years.map((y) => {
    const active = y === daycountState.year ? "active" : "";
    return `<button class="chip-button ${active}" data-year="${y}">${y}</button>`;
  }).join("");

  const { countries } = calculateDaysByCountry(trips, daycountState.passenger, daycountState.year);
  const countryNames = Object.keys(countries || {}).sort();
  if (!countryNames.length) {
    emptyEl.textContent = "No travel data for this year.";
    emptyEl.classList.remove("hidden");
    resultsEl.innerHTML = "";
    return;
  }

  emptyEl.classList.add("hidden");
  resultsEl.innerHTML = countryNames.map((country) => {
    const months = countries[country] || [];
    const total = months.reduce((a, b) => a + (b || 0), 0);
    const monthCells = monthLabels.map((label, idx) => {
      const days = months[idx] || 0;
      const cls = days === 0 ? 'class="value zero"' : 'class="value"';
      return `
        <div class="daycount-month">
          <div class="label">${label}</div>
          <div ${cls}>${days}</div>
        </div>`;
    }).join("");
    return `
      <div class="daycount-country">
        <div class="daycount-country-header">
          <span>${country}</span>
          <span class="daycount-country-total">${total} days</span>
        </div>
        <div class="daycount-months">
          ${monthCells}
        </div>
      </div>
    `;
  }).join("");

}

function renderUpcomingScreen() {
  const listEl = els["upcoming-list"];
  const emptyEl = els["upcoming-empty"];
  const passSelect = els["upcoming-passenger"];
  if (!listEl || !emptyEl) return;

  // Populate passengers
  const passengers = getAllPassengers(trips);
  if (passSelect) {
    passSelect.innerHTML = '<option value="">All passengers</option>';
    passengers.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      if (p === upcomingState.passenger) opt.selected = true;
      passSelect.appendChild(opt);
    });
    // If stored passenger no longer exists, reset
    if (upcomingState.passenger && !passengers.includes(upcomingState.passenger)) {
      upcomingState.passenger = "";
      passSelect.value = "";
    }
  }

  const filterPax = passSelect ? (passSelect.value || upcomingState.passenger || "") : upcomingState.passenger;
  if (filterPax !== undefined) upcomingState.passenger = filterPax;
  const filterValue = filterPax === "" ? null : filterPax;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const allFlights = getUpcomingFlights(trips, filterValue)
    .map((f) => ({ ...f }))
    .filter((f) => f.date >= today);

  const depMs = (f) => {
    const src = f.departureTime || (typeof f.date === "string" ? `${f.date}T00:00:00` : f.date);
    const d = new Date(src);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  };

  if (!allFlights.length) {
    emptyEl.classList.remove("hidden");
    listEl.innerHTML = "";
    return;
  }

  // Group connecting flights by same PNR and departure day
  const groupsMap = new Map();
  const singles = [];

  allFlights.forEach((f) => {
    const pnrKey = (f.pnr || "").trim();
    const depIso = f.departureTime || f.date;
    const d = depIso ? new Date(depIso) : null;
    const dayKey = d && !isNaN(d) ? d.toISOString().slice(0, 10) : "";
    if (pnrKey && dayKey) {
      const key = `${dayKey}__${pnrKey}`;
      if (!groupsMap.has(key)) groupsMap.set(key, []);
      groupsMap.get(key).push(f);
    } else {
      singles.push(f);
    }
  });

  const buckets = [];
  groupsMap.forEach((arr) => {
    const legs = arr.slice().sort((a, b) => depMs(a) - depMs(b));
    const sortKey = depMs(legs[0]);
    buckets.push({ sortKey, legs });
  });
  singles.forEach((f) => buckets.push({ sortKey: depMs(f), legs: [f] }));

  buckets.sort((a, b) => a.sortKey - b.sortKey);

  const tiles = buckets.map(({ legs }) => {
    const first = legs[0];
    const isGroup = legs.length > 1;
    const dateLabel = formatDateTimeLocal(first.departureTime || first.date);
    const fn = first.flightNumber || "Flight";
    const pnr = first.pnr || "";
    const pax = Array.from(new Set(legs.flatMap((l) => l.paxNames || []))).join(", ");
    const pnrSpan = pnr ? `<span class="pnr-text">PNR: ${pnr}</span>` : "";
    const paxSpan = pax ? `<span class="pax-text">Pax: ${pax}</span>` : "";
    const infoLine = [pnrSpan, paxSpan].filter(Boolean).join(" · ");

    const segments = legs.map((f) => {
      const depTime = f.departureTime ? extractTime(f.departureTime) : "";
      const arrTime = f.arrivalTime ? extractTime(f.arrivalTime) : "";
      const depName = f.departureName || f.departureCode || "?";
      const arrName = f.arrivalName || f.arrivalCode || "?";
      const depCode = f.departureCode || (depName ? depName.slice(0, 3).toUpperCase() : "?");
      const arrCode = f.arrivalCode || (arrName ? arrName.slice(0, 3).toUpperCase() : "?");
      return `
        <div class="segment-main-row" style="padding:6px 0;">
          <div class="segment-side">
            <div class="segment-city">
              <span class="mobile-hide">${depName}</span>
              <span class="mobile-only">${depCode}</span>
            </div>
            <div class="segment-code-time">
              <span class="segment-time">${depTime}</span>
            </div>
          </div>
          <div class="segment-arrow">
            <span class="segment-icon segment-icon-flight" aria-hidden="true">✈︎</span>
          </div>
          <div class="segment-side segment-side-right">
            <div class="segment-city">
              <span class="mobile-hide">${arrName}</span>
              <span class="mobile-only">${arrCode}</span>
            </div>
            <div class="segment-code-time">
              <span class="segment-time">${arrTime}</span>
            </div>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="flight-tile itinerary-tile">
        <div class="flight-tile-header">
          <div class="flight-tile-header-left">
            <span class="event-type-icon event-type-icon-flight">✈︎</span>
            <span class="flight-date">${dateLabel}</span>
          </div>
          <span class="flight-airline">${fn}</span>
        </div>
        <div class="itinerary-body">
          <div class="itinerary-segment segment-flight">
            <div class="segment-header-row">
              <span class="segment-label mobile-hide">${isGroup ? "Connecting" : "Upcoming"}</span>
              <span class="segment-flight-code">${infoLine}</span>
            </div>
            ${segments}
          </div>
        </div>
      </div>
    `;
  });

  emptyEl.classList.add("hidden");
  listEl.innerHTML = tiles.join("");
}

// -------------------------
// Map screen (Leaflet)
// -------------------------

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

function getFlightYearsForPassenger(passengerOrNull) {
  const years = new Set();
  const flights = getPassengerFlights(trips, passengerOrNull);
  for (const f of flights) {
    years.add(f.date.getFullYear());
  }
  return Array.from(years).sort((a, b) => a - b);
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

function renderMapControls() {
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

function ensureMapInitialized() {
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

  mapRoutesLayer = window.L.layerGroup().addTo(mapInstance);
  mapAirportsLayer = window.L.layerGroup().addTo(mapInstance);
  mapLabelsLayer = window.L.layerGroup().addTo(mapInstance);

  mapInstance.setView([20, 0], 2);
  return true;
}

function renderMapFlights() {
  const emptyEl = els["map-empty"];
  const warnEl = els["map-warning"];
  const mapEl = els["map-canvas"];
  if (!emptyEl || !warnEl || !mapEl) return;

  const hasLeaflet = ensureMapInitialized();
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
  const duplicatesRemovedCount = yearFlightsRaw.length - yearFlights.length;

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

  for (const route of routeBuckets) {
    const a = route.a;
    const b = route.b;
    if (!a || !b) continue;

    const countAB = route.flightsAB.length;
    const countBA = route.flightsBA.length;
    const total = countAB + countBA;
    if (!total) continue;

    const allFlightsForPair = route.flightsAB.concat(route.flightsBA);
    const dep = a;
    const arr = b;
    const count = total;

    const depAirports = Array.from(
      new Set(allFlightsForPair.map((f) => (f.departureCode || "").toUpperCase()).filter(Boolean))
    ).sort();
    const arrAirports = Array.from(
      new Set(allFlightsForPair.map((f) => (f.arrivalCode || "").toUpperCase()).filter(Boolean))
    ).sort();

    const uniquePax = Array.from(
      new Set(allFlightsForPair.flatMap((f) => (Array.isArray(f.paxNames) ? f.paxNames : [])))
    ).sort((x, y) => x.localeCompare(y));

    const flightsList = allFlightsForPair
      .slice()
      .sort((x, y) => x.date - y.date)
      .slice(0, 8)
      .map((f) => {
        const dt = f.departureTime ? new Date(f.departureTime).toLocaleString() : f.date.toLocaleDateString();
        const fn = (f.flightNumber || "").trim();
        const airline = (f.airline || "").trim();
        const label = [airline, fn].filter(Boolean).join(" ").trim() || "Flight";
        return `<div style="margin-top:4px;"><span style="font-weight:600;">${escapeHtml(label)}</span> — ${escapeHtml(dt)}</div>`;
      })
      .join("");

    const moreCount = total > 8 ? total - 8 : 0;
    const popup = `
      <div style="min-width:240px;">
        <div style="font-weight:800;">${escapeHtml(dep.city)} → ${escapeHtml(arr.city)}</div>
        <div style="margin-top:4px;">${count} flight${count === 1 ? "" : "s"}</div>
        <div style="margin-top:6px; color:#6b7280; font-size:12px;">
          ${escapeHtml(dep.city)} &rarr; ${escapeHtml(arr.city)}: <b>${countAB}</b>
          &nbsp;&nbsp;|&nbsp;&nbsp;
          ${escapeHtml(arr.city)} &rarr; ${escapeHtml(dep.city)}: <b>${countBA}</b>
        </div>
        <div style="margin-top:8px;">
          <div><b>City A:</b> ${escapeHtml(dep.city)}${depAirports.length ? ` (${escapeHtml(depAirports.join(", "))})` : ""}</div>
          <div><b>City B:</b> ${escapeHtml(arr.city)}${arrAirports.length ? ` (${escapeHtml(arrAirports.join(", "))})` : ""}</div>
        </div>
        ${uniquePax.length ? `<div style="margin-top:8px;"><b>Pax:</b> ${escapeHtml(uniquePax.join(", "))}</div>` : ""}
        ${flightsList ? `<div style="margin-top:10px;">${flightsList}</div>` : ""}
        ${moreCount ? `<div style="margin-top:6px; color: #6b7280;">+${moreCount} more</div>` : ""}
      </div>
    `;

    const weight = Math.min(8, 2 + Math.log2(count + 1));
    window.L.polyline(
      [[dep.lat, dep.lon], [arr.lat, arr.lon]],
      { color: "#2563eb", weight, opacity: 0.85 }
    ).bindPopup(popup).addTo(mapRoutesLayer);

    const bearing = computeBearingDegrees(dep.lat, dep.lon, arr.lat, arr.lon);
    const rotAB = Math.round(bearing);
    const rotBA = Math.round((bearing + 180) % 360);
    const arrowRotation = rotAB;

    const [aKey, bKey] = [dep.key, arr.key].sort((x, y) => x.localeCompare(y));
    const sign = dep.key === aKey ? 1 : -1;
    const offsetPx = 12;
    const zoom = mapInstance.getZoom();
    const p1 = mapInstance.project(window.L.latLng(dep.lat, dep.lon), zoom);
    const p2 = mapInstance.project(window.L.latLng(arr.lat, arr.lon), zoom);
    const vx = p2.x - p1.x;
    const vy = p2.y - p1.y;
    const len = Math.hypot(vx, vy) || 1;
    const nx = (-vy / len) * offsetPx * sign;
    const ny = (vx / len) * offsetPx * sign;
    const tAB = 1 / 3;
    const tBA = 2 / 3;
    const pAB = window.L.point(p1.x + vx * tAB + nx, p1.y + vy * tAB + ny);
    const pBA = window.L.point(p1.x + vx * tBA - nx, p1.y + vy * tBA - ny);
    const labelLatLng = mapInstance.unproject(pAB, zoom);
    const labelLatLngBA = mapInstance.unproject(pBA, zoom);

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
      window.L.marker(labelLatLng, {
        zIndexOffset: countAB,
        icon: window.L.divIcon({
          className: "route-count-icon",
          html: labelHtmlForward,
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        })
      })
        .bindPopup(popup)
        .addTo(mapLabelsLayer);
    }

    if (countBA) {
      const labelHtmlBack = `
        <div class="route-count-badge">
          <div class="route-count-num">${countBA}</div>
          <div class="route-count-arrow" style="transform: rotate(${planeRotationAdj(rotBA)}deg);">&#9992;</div>
        </div>
      `;
      window.L.marker(labelLatLngBA, {
        zIndexOffset: countBA,
        icon: window.L.divIcon({
          className: "route-count-icon",
          html: labelHtmlBack,
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        })
      })
        .bindPopup(popup)
        .addTo(mapLabelsLayer);
    }
  }

  for (const node of nodesUsed.values()) {
    const airportCodes = (node.airports || []).map((a) => a.code).filter(Boolean).sort();
    const airportLine = airportCodes.length ? `<div style="margin-top:6px; color:#6b7280;">${escapeHtml(airportCodes.join(", "))}</div>` : "";

    window.L.circleMarker([node.lat, node.lon], {
      radius: 6,
      color: "#111827",
      weight: 1,
      fillColor: "#f97316",
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
      `${duplicatesRemovedCount ? `Removed ${duplicatesRemovedCount} duplicate flight${duplicatesRemovedCount === 1 ? "" : "s"}. ` : ""}` +
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
        `${duplicatesRemovedCount ? `Removed ${duplicatesRemovedCount} duplicate flight${duplicatesRemovedCount === 1 ? "" : "s"}. ` : ""}` +
        shownText +
        (skippedSameCityCount ? `${skippedSameCityCount} within the same city were skipped. ` : "") +
        (skippedMissingCoordsCount ? `${skippedMissingCoordsCount} missing coordinates were skipped.` : "");
    } else {
      if (duplicatesRemovedCount) {
        warnEl.classList.remove("hidden");
        warnEl.textContent = `Removed ${duplicatesRemovedCount} duplicate flight${duplicatesRemovedCount === 1 ? "" : "s"}.`;
      } else {
        warnEl.classList.add("hidden");
        warnEl.textContent = "";
      }
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

function renderMapScreen() {
  renderMapControls();
  renderMapFlights();
}

// Display current storage usage of the trips payload
function updateStorageUsage() {
  const target = els["storage-usage"];
  const menuTarget = els["storage-usage-menu"];
  try {
    const json = JSON.stringify(trips);
    const bytes = new TextEncoder().encode(json).length;
    const kb = bytes / 1024;
    const label = kb >= 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb.toFixed(1)} KB`;
    const text = `Storage: ${label}`;
    if (target) target.textContent = text;
    if (menuTarget) menuTarget.textContent = text;
  } catch {
    if (target) target.textContent = "Storage: n/a";
    if (menuTarget) menuTarget.textContent = "Storage: n/a";
  }
}

// ------------------------------------------------------------------
// Existing per-trip helpers (KEEP; still useful elsewhere)
// ------------------------------------------------------------------

function collectTripStats(trip) {
  if (!trip) return { flights: 0, hotels: 0, passengers: [] };
  
  const flightCount = trip.records.length;
  const hotelCount = trip.hotels.length;
  
  const uniquePax = new Set();
  trip.records.forEach(r => r.paxNames.forEach(name => uniquePax.add(name)));
  
  return {
    flights: flightCount,
    hotels: hotelCount,
    passengerCount: uniquePax.size,
    passengers: Array.from(uniquePax).sort()
  };
}

function renderTripDetails(trip, statsEl, paxEl, emptyEl) {
  const hasData = trip && (trip.records.length > 0 || trip.hotels.length > 0);
  
  if (!hasData) {
    statsEl.classList.add('hidden');
    paxEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }
  
  emptyEl.classList.add('hidden');
  statsEl.classList.remove('hidden');
  paxEl.classList.remove('hidden');
  
  const stats = collectTripStats(trip);
  
  statsEl.innerHTML = `
    <div class="stat-item">
      <div class="stat-label">Flights</div>
      <div class="stat-value">${stats.flights}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Hotels</div>
      <div class="stat-value">${stats.hotels}</div>
    </div>
  `;
  
  paxEl.innerHTML = `
    <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">
      Passengers (${stats.passengerCount})
    </div>
    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
      ${stats.passengers.map(p => 
        `<span class="badge">${p}</span>`
      ).join('')}
    </div>
  `;
}

// ------------------------------------------------------------------
// Global stats helpers for “All Trips Statistics” card
// ------------------------------------------------------------------

function parseDateOnly(isoOrDateStr) {
  if (!isoOrDateStr) return null;
  const d = new Date(isoOrDateStr);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(checkInStr, checkOutStr) {
  const inDate = parseDateOnly(checkInStr);
  const outDate = parseDateOnly(checkOutStr);
  if (!inDate || !outDate) return 0;

  inDate.setHours(0, 0, 0, 0);
  outDate.setHours(0, 0, 0, 0);

  const diffMs = outDate - inDate;
  const nights = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, nights);
}

function getTripDateRange(trip) {
  let min = null;
  let max = null;

  for (const rec of (trip.records || [])) {
    const depIso = rec.route?.departure?.scheduled;
    const dateStr = depIso || rec.flightDate || rec.createdAt;
    const d = parseDateOnly(dateStr);
    if (!d) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }

  for (const h of (trip.hotels || [])) {
    const d1 = parseDateOnly(h.checkInDate || h.createdAt);
    const d2 = parseDateOnly(h.checkOutDate || h.createdAt);
    const dates = [d1, d2].filter(Boolean);
    for (const d of dates) {
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
  }

  return { start: min, end: max };
}

function collectAllTripsStats(allTrips) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalTrips = allTrips.length;

  let totalFlights = 0;
  let totalHotelNights = 0;

  let pastTrips = 0, upcomingTrips = 0;
  let pastFlights = 0, upcomingFlights = 0;
  let pastHotelNights = 0, upcomingHotelNights = 0;

  const paxTotals = new Map();

  for (const trip of allTrips) {
    if (!trip) continue;

    const { end } = getTripDateRange(trip);
    const isPastTrip = end && end < today;

    if (isPastTrip) pastTrips++;
    else upcomingTrips++;

    for (const rec of (trip.records || [])) {
      totalFlights++;

      const depIso = rec.route?.departure?.scheduled;
      const d = parseDateOnly(depIso || rec.flightDate || rec.createdAt);
      const isPastFlight = d && d < today;

      if (isPastFlight) pastFlights++;
      else upcomingFlights++;

      const paxNames = Array.isArray(rec.paxNames) ? rec.paxNames : [];
      for (const rawName of paxNames) {
        const name = String(rawName || "").trim();
        if (!name) continue;

        if (!paxTotals.has(name)) {
          paxTotals.set(name, {
            flights: 0,
            pastFlights: 0,
            upcomingFlights: 0,
            trips: new Set()
          });
        }
        const p = paxTotals.get(name);
        p.flights++;
        if (isPastFlight) p.pastFlights++;
        else p.upcomingFlights++;
        p.trips.add(trip.id);
      }
    }

    for (const h of (trip.hotels || [])) {
      const nights = daysBetween(h.checkInDate, h.checkOutDate);
      totalHotelNights += nights;

      const d = parseDateOnly(h.checkInDate || h.createdAt);
      const isPastHotel = d && d < today;

      if (isPastHotel) pastHotelNights += nights;
      else upcomingHotelNights += nights;
    }
  }

  const paxList = Array.from(paxTotals.entries())
    .map(([name, v]) => ({
      name,
      flights: v.flights,
      pastFlights: v.pastFlights,
      upcomingFlights: v.upcomingFlights,
      tripCount: v.trips.size
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    totalTrips,
    totalFlights,
    totalHotelNights,

    pastTrips,
    upcomingTrips,
    pastFlights,
    upcomingFlights,
    pastHotelNights,
    upcomingHotelNights,

    paxList
  };
}

function renderAllTripsDetails(allTrips, statsEl, paxEl, emptyEl) {
  const hasData =
    Array.isArray(allTrips) &&
    allTrips.some(t => (t?.records?.length || 0) > 0 || (t?.hotels?.length || 0) > 0);

  if (!hasData) {
    statsEl.classList.add('hidden');
    paxEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  statsEl.classList.remove('hidden');
  paxEl.classList.remove('hidden');

  const s = collectAllTripsStats(allTrips);

  const statCards = [
    { label: "Trips", total: s.totalTrips, past: s.pastTrips, upcoming: s.upcomingTrips },
    { label: "Flights", total: s.totalFlights, past: s.pastFlights, upcoming: s.upcomingFlights },
    { label: "Hotel Nights", total: s.totalHotelNights, past: s.pastHotelNights, upcoming: s.upcomingHotelNights }
  ];

  statsEl.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr; gap: 8px;">
      ${statCards.map(card => `
        <div class="secondary-card" style="padding: 10px 12px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-weight:600;">${card.label}</div>
            <div style="font-size:18px; font-weight:700;">${card.total}</div>
          </div>
          <div style="margin-top:6px; font-size:12px; color:var(--text-secondary);">
            Past: ${card.past} &nbsp;•&nbsp; Upcoming: ${card.upcoming}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  if (!s.paxList.length) {
    paxEl.innerHTML = `<div class="tiles-empty">No passengers recorded yet.</div>`;
    return;
  }

  paxEl.innerHTML = `
    <div style="font-size: 14px; font-weight: 600; margin: 10px 0 8px;">
      Passengers (${s.paxList.length})
    </div>
    <div style="display: grid; grid-template-columns: 1fr; gap: 8px;">
      ${s.paxList.map(p => `
        <div class="secondary-card" style="padding: 10px 12px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-weight:600;">${p.name}</div>
            <div class="tag-soft">${p.tripCount} trip${p.tripCount === 1 ? "" : "s"}</div>
          </div>
          <div style="margin-top:6px; font-size:12px; color:var(--text-secondary);">
            Flights: <b>${p.flights}</b>
            &nbsp;•&nbsp; Past: ${p.pastFlights}
            &nbsp;•&nbsp; Upcoming: ${p.upcomingFlights}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// -- Initialization --

async function init() {
  cacheElements();
  trips = loadTrips();
  activeTripId = trips.length ? trips[0].id : null;
  lastIsMobile = isMobileView();

  renderAll();
  updateTripNewFieldVisibility();
  syncAllTripsToggle();
  setStatusText("api-key-status", "Loading configuration...");
  const keyStatus = await loadApiKey();
  setStatusText("api-key-status", keyStatus.message);
  setConfigUploadVisibility(!keyStatus.success);

  updateAddFlightState();
  updateAddHotelState();
  setupEventListeners();

  window.addEventListener("resize", handleResponsiveResize);
  switchScreen(currentScreen);
}

function renderAll() {
  renderTripsJson(trips);
  renderTripSelect(trips, activeTripId);
  renderPassengerSelect(trips);
  renderHotelSelect(trips);
  
  const currentTrip = trips.find(t => String(t.id) === String(activeTripId)) || null;

  // Trip events (3 args now; no trip-name-summary anymore)
  renderTripEvents(
    currentTrip,
    els["trip-events-list"],
    els["trip-events-summary"]
  );
  
  renderAllTripsDetails(
    trips,
    els["trip-stats-container"], 
    els["trip-pax-container"],
    els["trip-details-empty"]
  );

  updateTripNewFieldVisibility();
  syncAllTripsToggle();
  updateStorageUsage();
  renderDaycountView();
  renderMapControls();
  if (currentScreen === "map") {
    renderMapFlights();
  }
}

// -- State Helpers --

function hasTripChoice() {
  const sel = els["trip-existing"].value;
  const newName = els["trip-new-name"].value.trim();
  if (sel && sel !== "__new__") return true;
  if (!sel || sel === "__new__") return newName.length > 0;
  return false;
}

function getCurrentTrip() {
  let trip = trips.find(t => String(t.id) === String(activeTripId)) || null;
  if (!trip) {
    const newName = els["trip-new-name"].value.trim() || "New trip";
    trip = {
      id: Date.now(),
      name: newName,
      createdAt: new Date().toISOString(),
      records: [],
      hotels: []
    };
    trips.push(trip);
    activeTripId = trip.id;
    renderTripSelect(trips, activeTripId);
  }
  return trip;
}

// -- Validation --

function validateFlightFormState() {
  let ok = true;
  const flightRaw = els["flight-number"].value.trim();
  const dateVal = els["flight-date"].value;
  
  const selectedExisting = Array.from(els["pax-existing"].selectedOptions || []).map(o => o.value);
  const newNames = els["pax-new"].value.trim().split(",").map(s => s.trim()).filter(Boolean);
  const paxCount = normalizePassengerNames([...selectedExisting, ...newNames]).length;

  els["manual-route-error"].textContent = "";

  if (!hasTripChoice()) {
    ok = false;
    els["trip-error"].textContent = "Choose an existing trip or enter a new trip name.";
  } else {
    els["trip-error"].textContent = "";
  }

  if (!flightRaw) {
    ok = false;
    els["flight-error"].textContent = "Please enter a flight number.";
  } else if (!isValidFlightNumber(flightRaw)) {
    ok = false;
    els["flight-error"].textContent = "Flight number looks invalid.";
  } else {
    els["flight-error"].textContent = "";
  }

  if (!dateVal) {
    ok = false;
    els["flight-date-error"].textContent = "Please enter the flight date.";
  } else {
    els["flight-date-error"].textContent = "";
  }

  if (paxCount === 0) {
    ok = false;
    els["pax-error"].textContent = "Select or add at least one passenger.";
  } else {
    els["pax-error"].textContent = "";
  }

  if (manualRouteMode && !editingFlightId) {
    let manualOk = true;
    if (!els["manual-dep-airport"].value.trim() || !els["manual-arr-airport"].value.trim()) manualOk = false;
    if (!els["manual-dep-time"].value || !els["manual-arr-time"].value) manualOk = false;
    if (!manualOk) {
      ok = false;
      els["manual-route-error"].textContent = "Please fill departure/arrival details.";
    }
  }

  if (els.flightSubmitBtn) els.flightSubmitBtn.disabled = !ok;
}

function validateHotelFormState() {
  let ok = true;
  const existingVal = els["hotel-existing"].value;
  const newName = els["hotel-name"].value.trim();
  const pax = Number(els["hotel-pax"].value.trim() || "0");
  const checkIn = els["hotel-checkin"].value;
  const checkOut = els["hotel-checkout"].value;

  if (!hasTripChoice()) {
    ok = false;
    els["trip-error"].textContent = "Choose a trip.";
  } else {
    els["trip-error"].textContent = "";
  }

  if ((!existingVal || existingVal === "__new__") && !newName) {
    ok = false;
    els["hotel-name-error"].textContent = "Enter a hotel name.";
  } else if (existingVal && existingVal !== "__new__" && newName) {
    ok = false;
    els["hotel-name-error"].textContent = "Choose existing OR new, not both.";
  } else {
    els["hotel-name-error"].textContent = "";
  }

  if (!pax || pax < 1) {
    ok = false;
    els["hotel-pax-error"].textContent = "At least 1 guest.";
  } else {
    els["hotel-pax-error"].textContent = "";
  }

  if (!checkIn || !checkOut) {
    ok = false;
    els["hotel-dates-error"].textContent = "Enter dates.";
  } else if (checkOut < checkIn) {
    ok = false;
    els["hotel-dates-error"].textContent = "Check-out must be after check-in.";
  } else {
    els["hotel-dates-error"].textContent = "";
  }

  if (els.hotelSubmitBtn) els.hotelSubmitBtn.disabled = !ok;
}

function updateAddFlightState() {
  if (hasTripChoice()) {
    els["add-flight-btn"].disabled = false;
    els["trip-error"].textContent = "";
  } else {
    els["add-flight-btn"].disabled = true;
    els["trip-error"].textContent = "Choose a trip first.";
  }
}
function updateAddHotelState() {
  if (hasTripChoice()) {
    els["add-hotel-btn"].disabled = false;
    els["trip-error"].textContent = "";
  } else {
    els["add-hotel-btn"].disabled = true;
  }
}

// -- Event Listeners --

function setupEventListeners() {
  // Screen tabs (desktop) and bottom nav (mobile)
  document.querySelectorAll(".tab-btn, .nav-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const targetScreen = e.currentTarget.dataset.screen;
      switchScreen(targetScreen);
    });
  });

  // Header hamburger menu
  if (els["topbar-menu-btn"] && els["topbar-menu-panel"]) {
    els["topbar-menu-btn"].addEventListener("click", (e) => {
      e.stopPropagation();
      setTopbarMenuOpen(!topbarMenuOpen);
    });
    els["topbar-menu-panel"].addEventListener("click", (e) => {
      if (e.target.closest(".menu-item")) setTopbarMenuOpen(false);
    });
    document.addEventListener("click", (e) => {
      if (!topbarMenuOpen) return;
      const panel = els["topbar-menu-panel"];
      const btn = els["topbar-menu-btn"];
      if (!panel || !btn) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      setTopbarMenuOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && topbarMenuOpen) setTopbarMenuOpen(false);
    });
  }

  // Config upload (manual API key)
  if (els["config-upload-btn"] && els["config-upload-file"]) {
    els["config-upload-btn"].addEventListener("click", (e) => {
      e.stopPropagation();
      els["config-upload-file"].click();
    });
    els["config-upload-file"].addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const key = ((json && (json.AVIATIONSTACK_API_KEY || json.apiKey)) || "").trim();
        if (!key) {
          alert("No API key found in file.");
          return;
        }
        localStorage.setItem("apiKeyOverride", key);
        apiState.key = key;
        setStatusText("api-key-status", "API key loaded from upload.");
        setConfigUploadVisibility(false);
      } catch (err) {
        console.error(err);
        alert("Could not read config.json");
      } finally {
        e.target.value = "";
      }
    });
  }

  // Daycount selectors
  if (els["daycount-passenger"]) {
    els["daycount-passenger"].addEventListener("change", (e) => {
      daycountState.passenger = e.target.value;
      const years = getPassengerYears(trips, daycountState.passenger);
      if (years.length) daycountState.year = years[0];
      renderDaycountView();
    });
  }
  if (els["daycount-year-list"]) {
    els["daycount-year-list"].addEventListener("click", (e) => {
      const btn = e.target.closest(".chip-button");
      if (!btn) return;
      const year = Number(btn.dataset.year);
      if (!isNaN(year)) {
        daycountState.year = year;
        renderDaycountView();
      }
    });
  }

  // Map selectors
  if (els["map-passenger"]) {
    els["map-passenger"].addEventListener("change", (e) => {
      const val = e.target.value;
      mapState.passenger = val === "__all__" ? null : val;
      renderMapScreen();
    });
  }
  if (els["map-route"]) {
    els["map-route"].addEventListener("change", (e) => {
      const val = e.target.value;
      mapState.routeKey = val === "__all__" ? null : val;
      renderMapScreen();
    });
  }
  if (els["map-year-list"]) {
    els["map-year-list"].addEventListener("click", (e) => {
      const btn = e.target.closest(".chip-button");
      if (!btn) return;
      const year = Number(btn.dataset.year);
      if (!isNaN(year)) {
        mapState.year = year;
        renderMapScreen();
      }
    });
  }

  if (els["upcoming-passenger"]) {
    els["upcoming-passenger"].addEventListener("change", () => {
      upcomingState.passenger = els["upcoming-passenger"].value || "";
      renderUpcomingScreen();
    });
  }

  // Delete flight/hotel from timeline
  if (els["trip-events-list"]) {
    els["trip-events-list"].addEventListener("click", (e) => {
      const editBtn = e.target.closest(".edit-chip");
      if (editBtn) {
        const id = editBtn.dataset.id;
        const trip = trips.find(t => String(t.id) === String(activeTripId));
        const record = trip?.records?.find(r => String(r.id) === String(id));
        if (record) startEditFlight(record);
        return;
      }

      const btn = e.target.closest(".delete-chip");
      if (!btn) return;
      const type = btn.dataset.type;
      const id = btn.dataset.id;
      if (!type || !id) return;
      if (!confirm(`Delete this ${type}?`)) return;

      const trip = trips.find(t => String(t.id) === String(activeTripId));
      if (!trip) return;

      if (type === "flight") {
        trip.records = (trip.records || []).filter(r => String(r.id) !== String(id));
      } else if (type === "hotel") {
        trip.hotels = (trip.hotels || []).filter(h => String(h.id) !== String(id));
      }

      saveTrips(trips);
      renderAll();
    });
  }

  // Mobile toggle All Trips Statistics
  if (els["toggle-alltrips-btn"]) {
    els["toggle-alltrips-btn"].addEventListener("click", () => {
      const card = document.querySelector(".card-trip-details");
      if (!card) return;
      card.classList.toggle("is-expanded");
      syncAllTripsToggle();
    });
  }

  els["trip-existing"].addEventListener("change", () => {
    const val = els["trip-existing"].value;
    if (val && val !== "__new__") {
      activeTripId = val;
      els["trip-new-name"].value = "";
    } else {
      activeTripId = null;
    }
    updateTripNewFieldVisibility();
    renderAll();
    updateAddFlightState();
    updateAddHotelState();
  });

  els["trip-new-name"].addEventListener("input", () => {
    if (els["trip-existing"].value !== "__new__") {
      els["trip-existing"].value = "__new__";
      activeTripId = null;
      updateTripNewFieldVisibility();

      renderTripEvents(null, els["trip-events-list"], els["trip-events-summary"]);

      renderAllTripsDetails(
        trips,
        els["trip-stats-container"], 
        els["trip-pax-container"],
        els["trip-details-empty"]
      );
    }
    updateAddFlightState();
    updateAddHotelState();
  });

  // UI Overlays
  els["add-flight-btn"].addEventListener("click", () => {
    resetFlightOverlayState();
    els["flight-overlay"].classList.remove("hidden");
    validateFlightFormState();
  });
  
  els["close-flight-overlay"].addEventListener("click", () => {
    resetFlightOverlayState();
    els["flight-overlay"].classList.add("hidden");
  });
  els["cancel-flight-btn"].addEventListener("click", () => {
    resetFlightOverlayState();
    els["flight-overlay"].classList.add("hidden");
  });

  els["add-hotel-btn"].addEventListener("click", () => {
    els["hotel-overlay"].classList.remove("hidden");
    validateHotelFormState();
  });

  els["close-hotel-overlay"].addEventListener("click", () => els["hotel-overlay"].classList.add("hidden"));
  els["cancel-hotel-btn"].addEventListener("click", () => els["hotel-overlay"].classList.add("hidden"));

  // Form Validations
  ["flight-number", "flight-date", "pax-new", "manual-airline", "manual-dep-airport", "manual-arr-airport"]
    .forEach(id => els[id]?.addEventListener("input", validateFlightFormState));
  els["pax-existing"].addEventListener("change", validateFlightFormState);
  
  ["hotel-existing", "hotel-name", "hotel-pax", "hotel-id"]
    .forEach(id => els[id]?.addEventListener("input", validateHotelFormState));
  ["hotel-checkin", "hotel-checkout"].forEach(id => els[id]?.addEventListener("change", validateHotelFormState));

  // Flight Submit
  els["flight-form"].addEventListener("submit", async (e) => {
    e.preventDefault();
    if (els.flightSubmitBtn.disabled) return;
    const editingId = editingFlightId;

    const flightNumberRaw = els["flight-number"].value.trim();
    const flightDate = els["flight-date"].value;
    const pnrRaw = els["pnr"].value.trim();

    const selectedPax = Array.from(els["pax-existing"].selectedOptions).map(o => o.value);
    const newPax = els["pax-new"].value.split(",").map(s => s.trim()).filter(Boolean);
    const paxNames = normalizePassengerNames([...selectedPax, ...newPax]);

    const currentTrip = getCurrentTrip();
    const existingRecord = editingId
      ? currentTrip.records.find(r => String(r.id) === String(editingId))
      : null;
    let route;

    if (!manualRouteMode && !editingId) {
      try {
        let baseRoute = null;
        const cached = findCachedRoute(trips, flightNumberRaw, flightDate);
        if (cached && confirm("Found saved route. Use it?")) {
          baseRoute = cached;
        } else {
          els["output"].textContent = "Fetching...";
          baseRoute = await fetchRoute(flightNumberRaw);
        }
        showImportedRouteForReview(baseRoute, flightDate);
      } catch (err) {
        if (confirm(`API Error: ${err.message}. Enter manually?`)) {
          manualRouteMode = true;
          els["manual-route-section"].classList.remove("hidden");
          validateFlightFormState();
          return;
        }
        return;
      }
      return;
    }

    const existingRoute = existingRecord?.route || {};
    const depTimeVal = els["manual-dep-time"].value || extractTime(existingRoute.departure?.scheduled) || "00:00";
    const arrTimeVal = els["manual-arr-time"].value || extractTime(existingRoute.arrival?.scheduled) || "00:00";
    route = {
      flightNumber: normalizeFlightNumber(els["manual-flight-number"].value || flightNumberRaw),
      airline: els["manual-airline"].value.trim(),
      departure: {
        airport: els["manual-dep-airport"].value.trim() || existingRoute.departure?.airport || "",
        iata: (els["manual-dep-iata"].value || existingRoute.departure?.iata || existingRoute.departure?.icao || "").trim().toUpperCase(),
        scheduled: `${flightDate}T${depTimeVal}:00`
      },
      arrival: {
        airport: els["manual-arr-airport"].value.trim() || existingRoute.arrival?.airport || "",
        iata: (els["manual-arr-iata"].value || existingRoute.arrival?.iata || existingRoute.arrival?.icao || "").trim().toUpperCase(),
        scheduled: `${flightDate}T${arrTimeVal}:00`
      }
    };

    if (editingId) {
      const idx = currentTrip.records.findIndex(r => String(r.id) === String(editingId));
      if (idx !== -1) {
        const existing = currentTrip.records[idx];
        currentTrip.records[idx] = {
          ...existing,
          flightDate,
          pnr: pnrRaw ? pnrRaw.toUpperCase() : null,
          paxNames,
          route
        };
      }
    } else {
      currentTrip.records.push({
        id: Date.now(),
        createdAt: new Date().toISOString(),
        flightDate,
        pnr: pnrRaw ? pnrRaw.toUpperCase() : null,
        paxNames,
        route
      });
    }

    saveTrips(trips);
    renderAll();
    resetFlightOverlayState();
    els["flight-overlay"].classList.add("hidden");
  });

  // Hotel Submit
  els["hotel-form"].addEventListener("submit", (e) => {
    e.preventDefault();
    if (els.hotelSubmitBtn.disabled) return;

    const currentTrip = getCurrentTrip();
    let hotelName = els["hotel-name"].value.trim();
    if (!hotelName && els["hotel-existing"].value !== "__new__") {
      hotelName = els["hotel-existing"].value;
    }

    currentTrip.hotels.push({
      id: els["hotel-id"].value.trim() || generateHotelId(),
      createdAt: new Date().toISOString(),
      hotelName,
      checkInDate: els["hotel-checkin"].value,
      checkOutDate: els["hotel-checkout"].value,
      paxCount: Number(els["hotel-pax"].value),
      paymentType: els["hotel-payment"].value
    });

    saveTrips(trips);
    renderAll();
    els["hotel-overlay"].classList.add("hidden");
    els["hotel-form"].reset();
  });

  // Export/Import
  els["download-json"].addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(trips, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trips.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  els["import-json"].addEventListener("click", () => {
    const input = els["import-json-file"];
    if (input) input.value = ""; // allow re-selecting the same file after clear/import
    input?.click();
  });
  els["import-json-file"].addEventListener("change", (e) => {
    const fileInput = e.target;
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (Array.isArray(parsed)) {
          trips = parsed;
          saveTrips(trips);
          activeTripId = trips[0]?.id || null;
          renderAll();
          alert("Imported!");
        }
      } catch(err) { alert("Invalid JSON"); }
      fileInput.value = ""; // reset so the same file can be chosen again
    };
    reader.readAsText(file);
  });

  els["clear-json"].addEventListener("click", () => {
    if(confirm("Delete all data?")) {
      trips = [];
      activeTripId = null;
      saveTrips(trips);
      renderAll();
    }
  });
}

// Start
document.addEventListener("DOMContentLoaded", init);
