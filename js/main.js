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
import { renderDaycountView as renderDaycountViewScreen } from "./daycountScreen.js";
import { renderUpcomingScreen as renderUpcomingScreenView } from "./upcomingScreen.js";
import { renderAllTripsDetails } from "./tripStats.js";
import { getPassengerYears } from "./daycount.js";
import { createMapScreenController } from "./mapScreen.js";
import { setupEventListeners as setupEventListenersBindings } from "./bindings.js";

// -- Globals --
let trips = [];
let activeTripId = null;
let topbarMenuOpen = false;
let lastIsMobile = null;
let currentScreen = "trips";
let showPastTrips = false;
let daycountState = { passenger: "", year: new Date().getFullYear(), monthSelection: null };
let upcomingState = { passenger: "" };
let mapState = {
  passenger: null,
  routeKey: null,
  year: new Date().getFullYear(),
  showBadges: true,
  fullscreen: false
};

const mapController = createMapScreenController();

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
    "map-fullscreen-btn", "map-badges-btn",
    // Screen switching
    "screen-trips", "screen-daycount", "screen-upcoming", "screen-map",
    // Nav buttons
    "nav-trips", "nav-daycount", "nav-upcoming", "nav-map",
    // All trips statistics card
    "trip-stats-container", "trip-pax-container", "trip-details-empty",
    // Trip selector layout containers
    "trip-fields", "trip-existing-field", "trip-new-field",
    // Trip list toggle
    "trip-show-past",
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
  const isNew = selectVal === "__new__";

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

function syncShowPastTripsToggle() {
  if (els["trip-show-past"]) {
    els["trip-show-past"].checked = Boolean(showPastTrips);
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
  document.body.classList.add("overlay-open");
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
  } else {
    if (mapState.fullscreen) setMapFullscreen(false);
  }
}

function renderDaycountView() {
  renderDaycountViewScreen({ trips, daycountState, els });
}

function renderUpcomingScreen() {
  renderUpcomingScreenView({ trips, upcomingState, els });
}

// -------------------------
// Map screen (Leaflet)
// -------------------------
function renderMapControls() {
  mapController.renderMapControls({ trips, mapState, els });
}

function renderMapFlights() {
  mapController.renderMapFlights({ trips, mapState, els });
}

function renderMapScreen() {
  mapController.renderMapScreen({ trips, mapState, els });
}

function setMapFullscreen(on) {
  mapController.setMapFullscreen({ on, mapState, els });
}

function syncMapActionButtons() {
  mapController.syncMapActionButtons({ mapState, els });
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

// -- Initialization --

async function init() {
  cacheElements();
  showPastTrips = localStorage.getItem("showPastTrips") === "1";
  trips = loadTrips();
  activeTripId = null;
  lastIsMobile = isMobileView();

  renderAll();
  updateTripNewFieldVisibility();
  syncAllTripsToggle();
  syncShowPastTripsToggle();
  setStatusText("api-key-status", "Loading configuration...");
  const keyStatus = await loadApiKey();
  setStatusText("api-key-status", keyStatus.message);
  setConfigUploadVisibility(!keyStatus.success);

  updateAddFlightState();
  updateAddHotelState();
  setupEventListenersBindings({
    els,
    apiState,
    switchScreen,
    getTopbarMenuOpen: () => topbarMenuOpen,
    setTopbarMenuOpen,
    setStatusText,
    setConfigUploadVisibility,
    daycountState,
    mapState,
    upcomingState,
    getTrips: () => trips,
    setTrips: (next) => { trips = next; },
    getActiveTripId: () => activeTripId,
    setActiveTripId: (next) => { activeTripId = next; },
    getShowPastTrips: () => showPastTrips,
    setShowPastTrips: (next) => { showPastTrips = Boolean(next); },
    renderDaycountView,
    renderMapScreen,
    renderMapFlights,
    syncMapActionButtons,
    setMapFullscreen,
    renderUpcomingScreen,
    startEditFlight,
    saveTrips,
    renderAll,
    updateTripNewFieldVisibility,
    updateAddFlightState,
    updateAddHotelState,
    resetFlightOverlayState,
    validateFlightFormState,
    validateHotelFormState,
    getCurrentTrip,
    findCachedRoute,
    fetchRoute,
    showImportedRouteForReview,
    extractTime,
    normalizePassengerNames,
    normalizeFlightNumber,
    generateHotelId,
    getPassengerYears,
    renderTripEvents,
    renderAllTripsDetails,
    getManualRouteMode: () => manualRouteMode,
    setManualRouteMode: (next) => { manualRouteMode = Boolean(next); },
    getEditingFlightId: () => editingFlightId,
    syncAllTripsToggle
  });

  window.addEventListener("resize", handleResponsiveResize);
  switchScreen(currentScreen);
}

function renderAll() {
  renderTripsJson(trips);
  const selectedTripValue = els["trip-existing"]?.value || "";
  renderTripSelect(trips, activeTripId, { showPastTrips, selectedValue: selectedTripValue });
  renderPassengerSelect(trips);
  renderHotelSelect(trips);
  
  const currentTrip = trips.find(t => String(t.id) === String(activeTripId)) || null;

  // Trip events (3 args now; no trip-name-summary anymore)
  renderTripEvents(
    currentTrip,
    els["trip-events-list"],
    els["trip-events-summary"],
    null,
    { showAllItems: showPastTrips }
  );
  
  renderAllTripsDetails(
    trips,
    els["trip-stats-container"], 
    els["trip-pax-container"],
    els["trip-details-empty"]
  );

  updateTripNewFieldVisibility();
  syncAllTripsToggle();
  syncShowPastTripsToggle();
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
  if (sel === "__new__") return newName.length > 0;
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
    renderTripSelect(trips, activeTripId, { showPastTrips });
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

// Start
document.addEventListener("DOMContentLoaded", init);
