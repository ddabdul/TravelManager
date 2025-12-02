// =========================
// Config & storage
// =========================

const STORAGE_KEY = "flightTrips";
let API_KEY = null; // loaded from config.json

// -------------------------
// Helpers
// -------------------------

function normalizePassengerNames(names) {
  const map = new Map();
  for (const raw of names) {
    if (!raw || typeof raw !== "string") continue;
    const cleaned = raw.trim().replace(/\s+/g, " ");
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!map.has(key)) {
      map.set(key, cleaned);
    }
  }
  return Array.from(map.values());
}

function normalizeFlightNumber(flightNumber) {
  if (!flightNumber || typeof flightNumber !== "string") return "";
  return flightNumber.replace(/\s+/g, "").toUpperCase();
}

// 2 airline letters + 1–4 digits, optional space between
function isValidFlightNumber(str) {
  if (!str) return false;
  const trimmed = str.trim().toUpperCase();
  return /^[A-Z]{2}\s?\d{1,4}$/.test(trimmed);
}

function loadTrips() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("Failed to parse stored trips", e);
    return [];
  }
}

function saveTrips(trips) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trips, null, 2));
}

function updateApiKeyStatus(messageOverride) {
  const statusEl = document.getElementById("api-key-status");
  if (!statusEl) return;
  statusEl.textContent =
    messageOverride || (API_KEY ? "API key loaded from config.json." : "No API key loaded yet.");
}

// Load API key from config.json
async function loadApiKeyFromConfigJson() {
  try {
    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) {
      console.warn("config.json not found or not readable, status:", res.status);
      updateApiKeyStatus("config.json not found (status " + res.status + ").");
      return;
    }

    const cfg = await res.json();
    const key = ((cfg && (cfg.AVIATIONSTACK_API_KEY || cfg.apiKey)) || "").trim();

    if (!key) {
      console.warn("config.json loaded but no AVIATIONSTACK_API_KEY/apiKey field.");
      updateApiKeyStatus("config.json found but no key inside.");
      return;
    }

    API_KEY = key;
    updateApiKeyStatus("API key loaded from config.json.");
  } catch (e) {
    console.error("Error reading config.json:", e);
    updateApiKeyStatus("Could not read config.json.");
  }
}

// Aggregate passengers from all trips/records
function getAllPassengers(trips) {
  const all = [];
  for (const trip of trips) {
    if (!trip || !Array.isArray(trip.records)) continue;
    for (const rec of trip.records) {
      if (Array.isArray(rec.paxNames)) all.push(...rec.paxNames);
    }
  }
  const unique = normalizePassengerNames(all);
  unique.sort((a, b) => a.localeCompare(b));
  return unique;
}

function renderPassengerSelect(trips) {
  const select = document.getElementById("pax-existing");
  const passengers = getAllPassengers(trips);

  select.innerHTML = "";

  if (passengers.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No passengers saved yet";
    opt.disabled = true;
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  select.disabled = false;

  passengers.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

// Adjust ISO string date to a new YYYY-MM-DD, keeping time & timezone
function adjustIsoDateKeepingTime(isoString, newDateStr) {
  if (!isoString || !newDateStr) return isoString;
  const match = isoString.match(/T(.+)/);
  if (!match) return isoString;
  return `${newDateStr}T${match[1]}`;
}

function cloneRouteWithDate(route, flightDate) {
  if (!route) return null;
  const cloned = JSON.parse(JSON.stringify(route));
  if (cloned.departure && cloned.departure.scheduled) {
    cloned.departure.scheduled = adjustIsoDateKeepingTime(
      cloned.departure.scheduled,
      flightDate
    );
  }
  if (cloned.arrival && cloned.arrival.scheduled) {
    cloned.arrival.scheduled = adjustIsoDateKeepingTime(
      cloned.arrival.scheduled,
      flightDate
    );
  }
  return cloned;
}

function formatFriendlyDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function extractTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function computeDurationMinutes(depIso, arrIso) {
  const d1 = new Date(depIso);
  const d2 = new Date(arrIso);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  const diffMs = d2.getTime() - d1.getTime();
  return Math.round(diffMs / 60000);
}

function formatDuration(mins) {
  if (mins == null || !Number.isFinite(mins) || mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Find cached route across all trips by flight number (optionally preferring same date)
function findCachedRoute(trips, flightNumberRaw, flightDate) {
  const normTarget = normalizeFlightNumber(flightNumberRaw);
  if (!normTarget) return null;

  let dateMatch = null;
  let anyMatch = null;

  for (const trip of trips) {
    if (!trip || !Array.isArray(trip.records)) continue;
    for (const rec of trip.records) {
      const route = rec.route;
      if (!route) continue;
      const recFlightNum = (route.flightNumber && String(route.flightNumber)) || "";
      const normRec = normalizeFlightNumber(recFlightNum);
      if (!normRec || normRec !== normTarget) continue;

      if (rec.flightDate && flightDate && rec.flightDate === flightDate && !dateMatch) {
        dateMatch = route;
      }
      if (!anyMatch) anyMatch = route;
    }
  }
  return dateMatch || anyMatch;
}

async function fetchRoute(flightNumberRaw) {
  if (!API_KEY) {
    throw new Error("API key is not set. Ensure config.json is present and loaded.");
  }

  const flightNumber = normalizeFlightNumber(flightNumberRaw);
  const url = new URL("https://api.aviationstack.com/v1/flights");
  url.searchParams.set("access_key", API_KEY);
  url.searchParams.set("flight_iata", flightNumber);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error("HTTP error " + response.status);
  }

  const data = await response.json();
  if (!data || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error("No flight found for " + flightNumber);
  }

  const flight = data.data[0];

  const route = {
    flightNumber:
      (flight.flight && (flight.flight.iata || flight.flight.number)) || flightNumber,
    airline: (flight.airline && flight.airline.name) || null,
    departure: {
      airport: (flight.departure && flight.departure.airport) || null,
      iata: (flight.departure && flight.departure.iata) || null,
      icao: (flight.departure && flight.departure.icao) || null,
      scheduled: (flight.departure && flight.departure.scheduled) || null
    },
    arrival: {
      airport: (flight.arrival && flight.arrival.airport) || null,
      iata: (flight.arrival && flight.arrival.iata) || null,
      icao: (flight.arrival && flight.arrival.icao) || null,
      scheduled: (flight.arrival && flight.arrival.scheduled) || null
    }
  };

  return route;
}

function renderTripsJson(trips) {
  const savedEl = document.getElementById("saved-json");
  savedEl.textContent = JSON.stringify(trips, null, 2);
}

function renderTripSelect(trips, activeTripId) {
  const select = document.getElementById("trip-existing");
  select.innerHTML = "";

  const optNew = document.createElement("option");
  optNew.value = "__new__";
  optNew.textContent = "New trip";
  select.appendChild(optNew);

  trips.forEach((trip) => {
    const opt = document.createElement("option");
    opt.value = String(trip.id);
    const dateLabel = trip.createdAt
      ? new Date(trip.createdAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric"
        })
      : "";
    opt.textContent = dateLabel ? `${trip.name} (${dateLabel})` : trip.name;
    if (String(trip.id) === String(activeTripId)) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  if (!activeTripId) {
    select.value = "__new__";
  }
}

function renderTripFlights(trip, containerEl, summaryEl) {
  containerEl.innerHTML = "";

  if (!trip) {
    const empty = document.createElement("div");
    empty.className = "tiles-empty";
    empty.textContent =
      "Select an existing trip or enter a new trip name to see flights here.";
    containerEl.appendChild(empty);
    if (summaryEl) summaryEl.textContent = "No trip selected";
    return;
  }

  const records = Array.isArray(trip.records) ? trip.records.slice().sort((a, b) => {
    if (!a.flightDate || !b.flightDate) return 0;
    return a.flightDate.localeCompare(b.flightDate);
  }) : [];

  if (summaryEl) {
    const count = records.length;
    summaryEl.textContent =
      count === 0
        ? `${trip.name} • no flights yet`
        : `${trip.name} • ${count} flight${count > 1 ? "s" : ""}`;
  }

  if (records.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tiles-empty";
    empty.textContent = "No flights in this trip yet. Use “Add flight” to create one.";
    containerEl.appendChild(empty);
    return;
  }

  for (const rec of records) {
    const tile = document.createElement("div");
    tile.className = "flight-tile";

    const route = rec.route || {};
    const dep = route.departure || {};
    const arr = route.arrival || {};

    const dateLabel = formatFriendlyDate(rec.flightDate);
    const airlineLabel = `${route.airline || ""} ${route.flightNumber || ""}`.trim();

    const depTime = extractTime(dep.scheduled);
    const arrTime = extractTime(arr.scheduled);
    const durationMin = computeDurationMinutes(dep.scheduled, arr.scheduled);
    const durationLabel = formatDuration(durationMin);

    const depCode = dep.iata || dep.icao || "";
    const arrCode = arr.iata || arr.icao || "";
    const depName = dep.airport || "";
    const arrName = arr.airport || "";

    const pnrDisplay = rec.pnr || "—";
    const paxList = Array.isArray(rec.paxNames) ? rec.paxNames : [];

    tile.innerHTML = `
      <div class="flight-tile-header">
        <span class="flight-date">${dateLabel}</span>
        <span class="flight-airline">${airlineLabel || "Unknown flight"}</span>
      </div>

      <div class="flight-route">
        <div class="airport-info">
          <div class="airport-code">${depCode || "—"}</div>
          <div class="airport-time">${depTime || ""}</div>
          <div class="airport-name">${depName || ""}</div>
        </div>

        <div class="flight-arrow">
          →
          <div class="flight-duration">${durationLabel || ""}</div>
        </div>

        <div class="airport-info">
          <div class="airport-code">${arrCode || "—"}</div>
          <div class="airport-time">${arrTime || ""}</div>
          <div class="airport-name">${arrName || ""}</div>
        </div>
      </div>

      <div class="flight-footer">
        <div class="flight-detail">
          <span class="flight-detail-label">Booking Ref</span>
          <span class="flight-detail-value">${pnrDisplay}</span>
        </div>
        <div class="passenger-names">
          <span class="flight-detail-label">Passengers</span>
          <div class="passenger-list">
            ${
              paxList.length
                ? paxList
                    .map((name) => `<span class="passenger-name">${name}</span>`)
                    .join("")
                : '<span class="passenger-name">None saved</span>'
            }
          </div>
        </div>
      </div>
    `;

    containerEl.appendChild(tile);
  }
}

// =========================
// App bootstrap
// =========================

document.addEventListener("DOMContentLoaded", () => {
  // Core elements
  const tripSelect = document.getElementById("trip-existing");
  const tripNewInput = document.getElementById("trip-new-name");
  const tripErrorEl = document.getElementById("trip-error");
  const tripFlightsList = document.getElementById("trip-flights-list");
  const tripFlightsSummary = document.getElementById("trip-flights-summary");

  const addFlightBtn = document.getElementById("add-flight-btn");
  const flightOverlay = document.getElementById("flight-overlay");
  const overlayCloseBtn = document.getElementById("close-flight-overlay");
  const cancelFlightBtn = document.getElementById("cancel-flight-btn");
  const flightCard = document.querySelector(".card-flight");

  const form = document.getElementById("flight-form");
  const submitBtn = form.querySelector('button[type="submit"]');
  const outputEl = document.getElementById("output");
  const inputFlight = document.getElementById("flight-number");
  const inputDate = document.getElementById("flight-date");
  const selectPaxExisting = document.getElementById("pax-existing");
  const inputPaxNew = document.getElementById("pax-new");
  const inputPnr = document.getElementById("pnr");

  const flightErrorEl = document.getElementById("flight-error");
  const flightDateErrorEl = document.getElementById("flight-date-error");
  const paxErrorEl = document.getElementById("pax-error");

  const importBtn = document.getElementById("import-json");
  const importFile = document.getElementById("import-json-file");
  const downloadBtn = document.getElementById("download-json");
  const clearBtn = document.getElementById("clear-json");

  let trips = loadTrips();
  let activeTripId = trips.length ? trips[0].id : null;

  // Initial render
  renderTripsJson(trips);
  renderTripSelect(trips, activeTripId);
  renderPassengerSelect(trips);
  const initialTrip = trips.find((t) => String(t.id) === String(activeTripId)) || null;
  renderTripFlights(initialTrip, tripFlightsList, tripFlightsSummary);

  updateApiKeyStatus("Loading API key from config.json…");
  loadApiKeyFromConfigJson();

  // --- Trip selection helpers ---

  function hasTripChoice() {
    const sel = tripSelect.value;
    const newName = tripNewInput.value.trim();
    if (sel && sel !== "__new__") return true;
    if (!sel || sel === "__new__") return newName.length > 0;
    return false;
  }

  function closeOverlay() {
    flightOverlay.classList.add("hidden");
    flightOverlay.setAttribute("aria-hidden", "true");
  }

  function openOverlay() {
    flightOverlay.classList.remove("hidden");
    flightOverlay.setAttribute("aria-hidden", "false");
    flightCard.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function updateAddFlightState() {
    if (hasTripChoice()) {
      addFlightBtn.disabled = false;
      tripErrorEl.textContent = "";
    } else {
      addFlightBtn.disabled = true;
      tripErrorEl.textContent = "Choose an existing trip or enter a new trip name.";
      closeOverlay();
    }
  }

  // --- Flight form validation ---

  function getSelectedExistingPassengers() {
    return Array.from(selectPaxExisting.selectedOptions || [])
      .map((opt) => opt.value)
      .filter(Boolean);
  }

  function getNewPassengerNames() {
    const raw = inputPaxNew.value.trim();
    if (!raw) return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function validateFormState() {
    let ok = true;

    const flightRaw = inputFlight.value.trim();
    const dateVal = inputDate.value;
    const selectedExisting = getSelectedExistingPassengers();
    const newNames = getNewPassengerNames();
    const paxCount = normalizePassengerNames([...selectedExisting, ...newNames]).length;

    // Trip choice
    if (!hasTripChoice()) {
      ok = false;
      tripErrorEl.textContent = "Choose an existing trip or enter a new trip name.";
    } else {
      tripErrorEl.textContent = "";
    }

    // Flight number
    if (!flightRaw) {
      ok = false;
      flightErrorEl.textContent = "Please enter a flight number.";
    } else if (!isValidFlightNumber(flightRaw)) {
      ok = false;
      flightErrorEl.textContent = "Flight number looks invalid. Example: BA2785.";
    } else {
      flightErrorEl.textContent = "";
    }

    // Flight date
    if (!dateVal) {
      ok = false;
      flightDateErrorEl.textContent = "Please enter the flight date.";
    } else {
      flightDateErrorEl.textContent = "";
    }

    // Passengers
    if (paxCount === 0) {
      ok = false;
      paxErrorEl.textContent = "Select or add at least one passenger.";
    } else {
      paxErrorEl.textContent = "";
    }

    submitBtn.disabled = !ok;
  }

  // --- Event wiring ---

  tripSelect.addEventListener("change", () => {
    const val = tripSelect.value;
    if (val && val !== "__new__") {
      activeTripId = val;
      tripNewInput.value = "";
      const trip = trips.find((t) => String(t.id) === String(activeTripId)) || null;
      renderTripFlights(trip, tripFlightsList, tripFlightsSummary);
    } else {
      activeTripId = null;
      renderTripFlights(null, tripFlightsList, tripFlightsSummary);
    }
    updateAddFlightState();
    validateFormState();
  });

  tripNewInput.addEventListener("input", () => {
    // Ensure select shows "New trip"
    if (tripSelect.value !== "__new__") {
      tripSelect.value = "__new__";
      activeTripId = null;
      renderTripFlights(null, tripFlightsList, tripFlightsSummary);
    }
    updateAddFlightState();
    validateFormState();
  });

  // Add flight button shows the overlay
  addFlightBtn.addEventListener("click", () => {
    if (addFlightBtn.disabled) return;

    // reset flight-specific fields
    inputFlight.value = "";
    inputDate.value = "";
    inputPaxNew.value = "";
    inputPnr.value = "";
    if (selectPaxExisting && !selectPaxExisting.disabled) {
      Array.from(selectPaxExisting.options).forEach((opt) => (opt.selected = false));
    }
    outputEl.textContent = "{}";
    validateFormState();

    openOverlay();
    inputFlight.focus();
  });

  overlayCloseBtn.addEventListener("click", () => {
    closeOverlay();
  });

  cancelFlightBtn.addEventListener("click", () => {
    closeOverlay();
  });

  // Close overlay when clicking backdrop
  flightOverlay.addEventListener("click", (e) => {
    if (e.target === flightOverlay || e.target.classList.contains("overlay-backdrop")) {
      closeOverlay();
    }
  });

  // Flight form inputs -> validation
  inputFlight.addEventListener("input", validateFormState);
  inputDate.addEventListener("change", validateFormState);
  selectPaxExisting.addEventListener("change", validateFormState);
  inputPaxNew.addEventListener("input", validateFormState);

  // --- Form submit: fetch/choose route & save record ---

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    validateFormState();
    if (submitBtn.disabled) return;

    const flightNumberRaw = inputFlight.value.trim();
    const flightDate = inputDate.value;
    const pnrRaw = inputPnr.value.trim();

    const selectedExisting = getSelectedExistingPassengers();
    const newNames = getNewPassengerNames();
    const paxNames = normalizePassengerNames([...selectedExisting, ...newNames]);

    // Determine current trip (existing or new)
    let currentTrip =
      trips.find((t) => String(t.id) === String(activeTripId)) || null;

    if (!currentTrip) {
      const newName = tripNewInput.value.trim() || "New trip";
      const newTrip = {
        id: Date.now(),
        name: newName,
        createdAt: new Date().toISOString(),
        records: []
      };
      trips.push(newTrip);
      currentTrip = newTrip;
      activeTripId = newTrip.id;
      renderTripSelect(trips, activeTripId);
    }

    // Route: check cache first
    let baseRoute = null;
    let routeSource = "api";
    try {
      const cachedRoute = findCachedRoute(trips, flightNumberRaw, flightDate);
      if (cachedRoute) {
        const depAirport = (cachedRoute.departure && cachedRoute.departure.airport) || "";
        const depIata = (cachedRoute.departure && cachedRoute.departure.iata) || "";
        const arrAirport = (cachedRoute.arrival && cachedRoute.arrival.airport) || "";
        const arrIata = (cachedRoute.arrival && cachedRoute.arrival.iata) || "";
        const routeSummary = `${depAirport} (${depIata}) → ${arrAirport} (${arrIata})`;

        const msg =
          `A saved route already exists for flight ${normalizeFlightNumber(
            flightNumberRaw
          )}.\n\n` +
          `${routeSummary}\n\n` +
          "Use this existing route (no API call)?\n\n" +
          "OK = Use cached route\nCancel = Call the API again";

        const useCached = window.confirm(msg);
        if (useCached) {
          baseRoute = cachedRoute;
          routeSource = "cache";
        }
      }

      if (!baseRoute) {
        outputEl.textContent = JSON.stringify(
          { status: "Loading route from API..." },
          null,
          2
        );
        baseRoute = await fetchRoute(flightNumberRaw);
        routeSource = "api";
      }
    } catch (err) {
      console.error("Error during route lookup:", err);
      outputEl.textContent = JSON.stringify({ error: err.message }, null, 2);
      return;
    }

    // Adjust route dates to flightDate
    const route = cloneRouteWithDate(baseRoute, flightDate);
    const routeForPreview = { ...route, _source: routeSource };
    outputEl.textContent = JSON.stringify(routeForPreview, null, 2);

    // Build record
    const record = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      flightDate,
      pnr: pnrRaw ? pnrRaw.toUpperCase() : null,
      paxNames,
      route
    };

    // Save into trip
    currentTrip.records = currentTrip.records || [];
    currentTrip.records.push(record);

    // Persist & re-render
    saveTrips(trips);
    renderTripsJson(trips);
    renderPassengerSelect(trips);
    renderTripFlights(currentTrip, tripFlightsList, tripFlightsSummary);

    // Clear flight fields
    inputFlight.value = "";
    inputDate.value = "";
    inputPaxNew.value = "";
    inputPnr.value = "";
    if (!selectPaxExisting.disabled) {
      Array.from(selectPaxExisting.options).forEach((opt) => (opt.selected = false));
    }
    validateFormState();

    // Hide overlay until user chooses "Add flight" again
    closeOverlay();

    // Alert summary
    alert(
      `Saved flight to trip "${currentTrip.name}":\n` +
        `• Flight: ${normalizeFlightNumber(flightNumberRaw)} on ${flightDate}\n` +
        `• Passengers: ${paxNames.join(", ")}\n` +
        (record.pnr ? `• PNR: ${record.pnr}\n` : "") +
        `Source: ${routeSource === "cache" ? "existing route" : "API"}`
    );
  });

  // --- Import / export / clear JSON ---

  downloadBtn.addEventListener("click", () => {
    const dataStr = JSON.stringify(trips, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "trips.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  importBtn.addEventListener("click", () => {
    importFile.click();
  });

  importFile.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (!Array.isArray(parsed)) {
          throw new Error("Imported JSON must be an array of trips.");
        }
        trips = parsed;
        activeTripId = trips.length ? trips[0].id : null;
        saveTrips(trips);
        renderTripsJson(trips);
        renderTripSelect(trips, activeTripId);
        renderPassengerSelect(trips);
        const trip =
          trips.find((t) => String(t.id) === String(activeTripId)) || null;
        renderTripFlights(trip, tripFlightsList, tripFlightsSummary);
        updateAddFlightState();
        alert("Trips imported successfully.");
      } catch (err) {
        console.error("Import error:", err);
        alert("Could not import JSON: " + err.message);
      } finally {
        importFile.value = "";
      }
    };
    reader.readAsText(file);
  });

  clearBtn.addEventListener("click", () => {
    if (!confirm("Clear all trips and flights from this device?")) return;
    trips = [];
    activeTripId = null;
    saveTrips(trips);
    renderTripsJson(trips);
    renderTripSelect(trips, activeTripId);
    renderPassengerSelect(trips);
    renderTripFlights(null, tripFlightsList, tripFlightsSummary);
    updateAddFlightState();
  });

  // Final initial validation state
  updateAddFlightState();
  validateFormState();
});
