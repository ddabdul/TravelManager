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
  formatDateTimeLocal
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
import { getUpcomingFlights } from "./flights.js";

// -- Globals --
let trips = [];
let activeTripId = null;
let topbarMenuOpen = false;
let lastIsMobile = null;
let currentScreen = "trips";
let daycountState = { passenger: "", year: new Date().getFullYear() };
let upcomingState = { passenger: "" };

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
    // Screen switching
    "screen-trips", "screen-daycount", "screen-upcoming",
    // Nav buttons
    "nav-trips", "nav-daycount", "nav-upcoming",
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
  currentScreen = screen === "daycount" ? "daycount" : screen === "upcoming" ? "upcoming" : "trips";
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

  if (!allFlights.length) {
    emptyEl.classList.remove("hidden");
    listEl.innerHTML = "";
    return;
  }

  emptyEl.classList.add("hidden");
  const sorted = allFlights.slice().sort((a, b) => a.date - b.date);
  listEl.innerHTML = sorted.map((f) => {
    const dateLabel = formatDateTimeLocal(f.departureTime || f.date);
    const depTime = f.departureTime ? extractTime(f.departureTime) : "";
    const arrTime = f.arrivalTime ? extractTime(f.arrivalTime) : "";
    const fn = f.flightNumber || "Flight";
    const depCity = f.departureName || f.departureCode || "?";
    const arrCity = f.arrivalName || f.arrivalCode || "?";
    const pax = (f.paxNames || []).join(", ");
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
              <span class="segment-label">Upcoming</span>
              ${pax ? `<span class="segment-flight-code">Pax: ${pax}</span>` : ""}
            </div>
            <div class="segment-main-row">
              <div class="segment-side">
                <div class="segment-city">${depCity}</div>
                <div class="segment-code-time">
                  <span class="segment-time">${depTime}</span>
                </div>
              </div>
              <div class="segment-arrow">
                <span class="segment-icon segment-icon-flight" aria-hidden="true">✈︎</span>
              </div>
              <div class="segment-side segment-side-right">
                <div class="segment-city">${arrCity}</div>
                <div class="segment-code-time">
                  <span class="segment-time">${arrTime}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");
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

  if (manualRouteMode) {
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

  if (els["upcoming-passenger"]) {
    els["upcoming-passenger"].addEventListener("change", () => {
      upcomingState.passenger = els["upcoming-passenger"].value || "";
      renderUpcomingScreen();
    });
  }

  // Delete flight/hotel from timeline
  if (els["trip-events-list"]) {
    els["trip-events-list"].addEventListener("click", (e) => {
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
    manualRouteMode = false;
    els["manual-route-section"].classList.add("hidden");
    els["flight-overlay"].classList.remove("hidden");
    validateFlightFormState();
  });
  
  els["close-flight-overlay"].addEventListener("click", () => els["flight-overlay"].classList.add("hidden"));
  els["cancel-flight-btn"].addEventListener("click", () => els["flight-overlay"].classList.add("hidden"));

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

    const flightNumberRaw = els["flight-number"].value.trim();
    const flightDate = els["flight-date"].value;
    const pnrRaw = els["pnr"].value.trim();

    const selectedPax = Array.from(els["pax-existing"].selectedOptions).map(o => o.value);
    const newPax = els["pax-new"].value.split(",").map(s => s.trim()).filter(Boolean);
    const paxNames = normalizePassengerNames([...selectedPax, ...newPax]);

    const currentTrip = getCurrentTrip();
    let route;

    if (manualRouteMode) {
      route = {
        flightNumber: normalizeFlightNumber(els["manual-flight-number"].value || flightNumberRaw),
        airline: els["manual-airline"].value.trim(),
        departure: {
          airport: els["manual-dep-airport"].value.trim(),
          iata: els["manual-dep-iata"].value.trim().toUpperCase(),
          scheduled: `${flightDate}T${els["manual-dep-time"].value}:00`
        },
        arrival: {
          airport: els["manual-arr-airport"].value.trim(),
          iata: els["manual-arr-iata"].value.trim().toUpperCase(),
          scheduled: `${flightDate}T${els["manual-arr-time"].value}:00`
        }
      };
    } else {
      try {
        const cached = findCachedRoute(trips, flightNumberRaw, flightDate);
        if (cached && confirm("Found saved route. Use it?")) {
          route = cloneRouteWithDate(cached, flightDate);
        } else {
          els["output"].textContent = "Fetching...";
          const baseRoute = await fetchRoute(flightNumberRaw);
          route = cloneRouteWithDate(baseRoute, flightDate);
        }
      } catch (err) {
        if (confirm(`API Error: ${err.message}. Enter manually?`)) {
          manualRouteMode = true;
          els["manual-route-section"].classList.remove("hidden");
          validateFlightFormState();
          return;
        }
        return;
      }
    }

    currentTrip.records.push({
      id: Date.now(),
      createdAt: new Date().toISOString(),
      flightDate,
      pnr: pnrRaw ? pnrRaw.toUpperCase() : null,
      paxNames,
      route
    });

    saveTrips(trips);
    renderAll();
    els["flight-overlay"].classList.add("hidden");
    
    els["flight-form"].reset();
    els["output"].textContent = "{}";
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

  els["import-json"].addEventListener("click", () => els["import-json-file"].click());
  els["import-json-file"].addEventListener("change", (e) => {
    const file = e.target.files?.[0];
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
