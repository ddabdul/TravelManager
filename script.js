// =========================
// Config & storage
// =========================

const STORAGE_KEY = "flightTrips"; // new key: trips-based model
let API_KEY = null; // will be loaded from config.json

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

/**
 * Check that the flight number has a plausible IATA-style format:
 * - 2 alphanumeric airline characters (letters or letter+digit)
 * - optional space
 * - 1–4 digits
 * Examples: "LH438", "BA 2785", "U2145"
 */
function isValidFlightNumber(input) {
  if (!input || typeof input !== "string") return false;
  const trimmed = input.trim().toUpperCase();
  const pattern = /^[A-Z0-9]{2}\s?\d{1,4}$/;
  return pattern.test(trimmed);
}

// ---- Trips storage ----

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
    messageOverride || (API_KEY ? "API key loaded." : "No API key loaded yet.");
}

/**
 * Try to load API key automatically from config.json
 */
async function loadApiKeyFromConfigJson() {
  try {
    console.log("Attempting to load config.json…");
    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) {
      console.warn("config.json not found or not readable, status:", res.status);
      updateApiKeyStatus("config.json not found (status " + res.status + ").");
      return;
    }

    const cfg = await res.json();
    console.log("config.json loaded:", cfg);

    const key = (
      (cfg && (cfg.AVIATIONSTACK_API_KEY || cfg.apiKey)) ||
      ""
    ).trim();

    if (!key) {
      console.warn("config.json loaded but no AVIATIONSTACK_API_KEY/apiKey field.");
      updateApiKeyStatus("config.json found but no key inside.");
      return;
    }

    API_KEY = key;
    console.log("API key set from config.json");
    updateApiKeyStatus("API key loaded from config.json.");
  } catch (e) {
    console.error("Error reading config.json:", e);
    updateApiKeyStatus("Could not read config.json.");
  }
}

// ---- Rendering helpers ----

function renderTrips(trips) {
  const savedEl = document.getElementById("saved-json");
  savedEl.textContent = JSON.stringify(trips, null, 2);
}

function getPassengerList(trips) {
  const allNames = [];
  for (const trip of trips) {
    if (!trip || !Array.isArray(trip.records)) continue;
    for (const rec of trip.records) {
      if (Array.isArray(rec.paxNames)) {
        allNames.push(...rec.paxNames);
      }
    }
  }
  const unique = normalizePassengerNames(allNames);
  unique.sort((a, b) => a.localeCompare(b));
  return unique;
}

function renderPassengerSelect(trips) {
  const select = document.getElementById("pax-existing");
  const passengers = getPassengerList(trips);

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

function renderTripSelect(trips) {
  const select = document.getElementById("trip-existing");
  if (!select) return;

  select.innerHTML = "";

  if (!trips || trips.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No trips yet – name one below.";
    opt.disabled = true;
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  select.disabled = false;

  trips.forEach((trip) => {
    const opt = document.createElement("option");
    opt.value = String(trip.id);
    const dateLabel = trip.createdAt
      ? new Date(trip.createdAt).toISOString().slice(0, 10)
      : "";
    opt.textContent = dateLabel
      ? `${trip.name} (${dateLabel})`
      : trip.name;
    select.appendChild(opt);
  });
}

// ---- Route caching ----

function findCachedRoute(trips, flightNumberRaw, flightDate) {
  const normTarget = normalizeFlightNumber(flightNumberRaw);
  if (!normTarget) return null;

  let fallbackRoute = null;

  for (const trip of trips) {
    if (!trip || !Array.isArray(trip.records)) continue;
    for (const rec of trip.records) {
      if (!rec || !rec.route) continue;

      const recFlightNum =
        (rec.route.flightNumber && String(rec.route.flightNumber)) || "";
      const normRec = normalizeFlightNumber(recFlightNum);

      if (!normRec || normRec !== normTarget) continue;

      // Exact same date
      if (rec.flightDate && flightDate && rec.flightDate === flightDate) {
        return rec.route;
      }

      if (!fallbackRoute) {
        fallbackRoute = rec.route;
      }
    }
  }

  return fallbackRoute;
}

async function fetchRoute(flightNumberRaw) {
  if (!API_KEY) {
    throw new Error(
      "API key is not set. Ensure config.json is present and loaded."
    );
  }

  const flightNumber = normalizeFlightNumber(flightNumberRaw);

  const url = new URL("https://api.aviationstack.com/v1/flights");
  url.searchParams.set("access_key", API_KEY);
  url.searchParams.set("flight_iata", flightNumber);

  console.log("Calling API:", url.toString());

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error("HTTP error " + response.status);
  }

  const data = await response.json();
  console.log("API response:", data);

  if (!data || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error("No flight found for " + flightNumber);
  }

  const flight = data.data[0];

  const route = {
    flightNumber:
      (flight.flight && (flight.flight.iata || flight.flight.number)) ||
      flightNumber,
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

/**
 * Helper: override just the DATE part of a scheduled datetime,
 * keeping the time (and timezone) if present.
 * - travelDate: "YYYY-MM-DD"
 * - original: e.g. "2025-12-01T16:00:00+00:00" or "2025-12-01 16:00:00"
 */
function overrideScheduledDate(travelDate, original) {
  if (!travelDate) return original;

  if (typeof original === "string") {
    const tIndex = original.indexOf("T");
    const spaceIndex = original.indexOf(" ");
    let idx = -1;

    if (tIndex !== -1 && spaceIndex !== -1) {
      idx = Math.min(tIndex, spaceIndex);
    } else if (tIndex !== -1) {
      idx = tIndex;
    } else if (spaceIndex !== -1) {
      idx = spaceIndex;
    }

    if (idx !== -1) {
      const timePart = original.slice(idx); // includes 'T' or ' '
      return travelDate + timePart;
    }
  }

  // Fallback: just use the date
  return travelDate;
}

/**
 * Adjust departure/arrival 'scheduled' fields to the travel date,
 * but keep the original time-of-day from the API/cache.
 */
function adjustRouteDatesToFlightDate(route, flightDate) {
  const copy = JSON.parse(JSON.stringify(route || {}));

  if (!copy.departure) copy.departure = {};
  if (!copy.arrival) copy.arrival = {};

  copy.departure.scheduled = overrideScheduledDate(
    flightDate,
    copy.departure.scheduled
  );
  copy.arrival.scheduled = overrideScheduledDate(
    flightDate,
    copy.arrival.scheduled
  );

  console.log("adjustRouteDatesToFlightDate", {
    travelDate: flightDate,
    beforeDeparture: route && route.departure && route.departure.scheduled,
    beforeArrival: route && route.arrival && route.arrival.scheduled,
    afterDeparture: copy.departure.scheduled,
    afterArrival: copy.arrival.scheduled
  });

  return copy;
}

/**
 * Import trips from a JSON file.
 * The file must contain an array of trip objects.
 */
async function importTripsFromFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error("File is not valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Expected an array of trips in the JSON (array).");
  }

  return parsed;
}

// =========================
// App bootstrap
// =========================

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("flight-form");
  const outputEl = document.getElementById("output");
  const inputFlight = document.getElementById("flight-number");
  const inputDate = document.getElementById("flight-date");
  const selectPaxExisting = document.getElementById("pax-existing");
  const inputPaxNew = document.getElementById("pax-new");
  const inputPnr = document.getElementById("pnr");

  const selectTripExisting = document.getElementById("trip-existing");
  const inputTripNew = document.getElementById("trip-new-name");

  const importBtn = document.getElementById("import-json");
  const importFileInput = document.getElementById("import-json-file");
  const downloadBtn = document.getElementById("download-json");
  const clearBtn = document.getElementById("clear-json");

  // Error elements
  const flightErrorEl = document.getElementById("flight-error");
  const dateErrorEl = document.getElementById("flight-date-error");
  const paxErrorEl = document.getElementById("pax-error");
  const tripErrorEl = document.getElementById("trip-error");

  // Submit button we want to enable/disable
  const submitBtn = form.querySelector('button[type="submit"]');

  console.log("Flight Log app script loaded (with trips)");

  let trips = loadTrips();
  renderTrips(trips);
  renderPassengerSelect(trips);
  renderTripSelect(trips);

  updateApiKeyStatus("Loading API key from config.json…");
  loadApiKeyFromConfigJson();

  // --- Live validation & button enabling ---
  function hasPassengerSelectedOrNew() {
    const selectedExisting = Array.from(
      selectPaxExisting.selectedOptions || []
    )
      .map((opt) => opt.value)
      .filter(Boolean);

    const newRaw = inputPaxNew.value || "";
    const newNames = newRaw
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);

    return selectedExisting.length > 0 || newNames.length > 0;
  }

  function hasValidTripSelection() {
    const selectedTripId =
      !selectTripExisting.disabled && selectTripExisting.value
        ? selectTripExisting.value
        : "";
    const newTripName = (inputTripNew.value || "").trim();

    if (!selectedTripId && !newTripName) {
      // nothing chosen
      return false;
    }
    if (selectedTripId && newTripName) {
      // both chosen (not allowed)
      return false;
    }
    return true;
  }

  function updateSubmitButtonState() {
    const flightRaw = inputFlight.value.trim();
    const dateVal = inputDate.value;

    const flightOk = isValidFlightNumber(flightRaw);
    const dateOk = !!dateVal;
    const paxOk = hasPassengerSelectedOrNew();
    const tripOk = hasValidTripSelection();

    const allOk = flightOk && dateOk && paxOk && tripOk;

    // Button enabled/disabled
    submitBtn.disabled = !allOk;

    // Subtle inline errors
    if (flightErrorEl) {
      flightErrorEl.textContent =
        flightRaw && !flightOk
          ? "Use format like LH438 or BA 2785."
          : "";
    }

    if (dateErrorEl) {
      dateErrorEl.textContent =
        !dateOk && (flightRaw || paxOk || hasValidTripSelection())
          ? "Select a flight date."
          : "";
    }

    if (paxErrorEl) {
      paxErrorEl.textContent =
        !paxOk && (flightRaw || dateOk || hasValidTripSelection())
          ? "Add or select at least one passenger."
          : "";
    }

    if (tripErrorEl) {
      const selectedTripId =
        !selectTripExisting.disabled && selectTripExisting.value
          ? selectTripExisting.value
          : "";
      const newTripName = (inputTripNew.value || "").trim();

      if (!selectedTripId && !newTripName) {
        tripErrorEl.textContent =
          (flightRaw || dateOk || paxOk)
            ? "Select an existing trip or enter a new trip name."
            : "";
      } else if (selectedTripId && newTripName) {
        tripErrorEl.textContent =
          "Choose either an existing trip OR a new trip name, not both.";
      } else {
        tripErrorEl.textContent = "";
      }
    }
  }

  // Attach listeners to keep button state in sync
  inputFlight.addEventListener("input", updateSubmitButtonState);
  inputDate.addEventListener("input", updateSubmitButtonState);
  selectPaxExisting.addEventListener("change", updateSubmitButtonState);
  inputPaxNew.addEventListener("input", updateSubmitButtonState);
  selectTripExisting.addEventListener("change", updateSubmitButtonState);
  inputTripNew.addEventListener("input", updateSubmitButtonState);

  // Initial state (likely disabled)
  updateSubmitButtonState();

  // --- Form submit ---
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const flightNumberRaw = inputFlight.value.trim();
    const flightDate = inputDate.value;
    const pnrRaw = inputPnr.value.trim();
    const paxNewRaw = inputPaxNew.value.trim();
    const newTripName = (inputTripNew.value || "").trim();
    const selectedTripId =
      !selectTripExisting.disabled && selectTripExisting.value
        ? selectTripExisting.value
        : "";

    // Safety net validations
    if (!flightNumberRaw) {
      outputEl.textContent = JSON.stringify(
        { error: "Please enter a flight number." },
        null,
        2
      );
      return;
    }

    if (!isValidFlightNumber(flightNumberRaw)) {
      outputEl.textContent = JSON.stringify(
        {
          error:
            "Flight number format is invalid. Use something like LH438 or BA 2785 (2 letters/letter+digit + 1–4 digits)."
        },
        null,
        2
      );
      return;
    }

    if (!flightDate) {
      outputEl.textContent = JSON.stringify(
        { error: "Please enter the flight date." },
        null,
        2
      );
      return;
    }

    if (!hasPassengerSelectedOrNew()) {
      outputEl.textContent = JSON.stringify(
        { error: "Please select or enter at least one passenger." },
        null,
        2
      );
      return;
    }

    if (!hasValidTripSelection()) {
      outputEl.textContent = JSON.stringify(
        {
          error:
            "You must either select an existing trip OR enter a new trip name (but not both)."
        },
        null,
        2
      );
      return;
    }

    const flightNumber = flightNumberRaw; // keep original spacing for display
    const cachedRoute = findCachedRoute(trips, flightNumber, flightDate);
    let route;

    try {
      if (cachedRoute) {
        const depAirport =
          (cachedRoute.departure && cachedRoute.departure.airport) || "";
        const depIata =
          (cachedRoute.departure && cachedRoute.departure.iata) || "";
        const arrAirport =
          (cachedRoute.arrival && cachedRoute.arrival.airport) || "";
        const arrIata =
          (cachedRoute.arrival && cachedRoute.arrival.iata) || "";
        const routeSummary = `${depAirport} (${depIata}) → ${arrAirport} (${arrIata})`;

        const msg =
          `A saved route already exists for flight ${normalizeFlightNumber(
            flightNumber
          )}.\n\n` +
          `${routeSummary}\n\n` +
          "Use this existing route (no API call)?\n\n" +
          "OK = Use cached route\nCancel = Call the API again";

        const useCached = window.confirm(msg);

        if (useCached) {
          route = adjustRouteDatesToFlightDate(cachedRoute, flightDate);
          outputEl.textContent = JSON.stringify(
            { ...route, _source: "cache" },
            null,
            2
          );
        } else {
          outputEl.textContent = JSON.stringify(
            { status: "Loading route from API..." },
            null,
            2
          );
          const baseRoute = await fetchRoute(flightNumber);
          route = adjustRouteDatesToFlightDate(baseRoute, flightDate);
          outputEl.textContent = JSON.stringify(route, null, 2);
        }
      } else {
        outputEl.textContent = JSON.stringify(
          { status: "Loading route from API..." },
          null,
          2
        );
        const baseRoute = await fetchRoute(flightNumber);
        route = adjustRouteDatesToFlightDate(baseRoute, flightDate);
        outputEl.textContent = JSON.stringify(route, null, 2);
      }
    } catch (err) {
      console.error("Error during route lookup:", err);
      outputEl.textContent = JSON.stringify({ error: err.message }, null, 2);
      return;
    }

    try {
      const selectedExistingPax = Array.from(
        selectPaxExisting.selectedOptions || []
      )
        .map((opt) => opt.value)
        .filter(Boolean);

      const newNames = paxNewRaw
        ? paxNewRaw
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean)
        : [];

      const paxNames = normalizePassengerNames([
        ...selectedExistingPax,
        ...newNames
      ]);

      const record = {
        id: Date.now(),
        createdAt: new Date().toISOString(),
        flightDate: flightDate,
        pnr: pnrRaw ? pnrRaw.toUpperCase() : null,
        paxNames: paxNames,
        route: route
      };

      // Determine trip to attach to
      let tripToUse = null;

      if (newTripName && !selectedTripId) {
        // create new trip
        tripToUse = {
          id: Date.now(),
          name: newTripName,
          createdAt: new Date().toISOString(),
          records: []
        };
        trips.push(tripToUse);
      } else if (!newTripName && selectedTripId) {
        // use existing trip
        tripToUse = trips.find((t) => String(t.id) === String(selectedTripId));
        if (!tripToUse) {
          throw new Error("Selected trip not found.");
        }
      } else {
        // Should not happen if validations are correct
        throw new Error(
          "Trip selection invalid. Please select a trip or enter a new name."
        );
      }

      tripToUse.records.push(record);
      saveTrips(trips);
      renderTrips(trips);
      renderPassengerSelect(trips);
      renderTripSelect(trips);

      // If we just created a new trip, select it in the dropdown
      if (newTripName && tripToUse && selectTripExisting && !selectTripExisting.disabled) {
        selectTripExisting.value = String(tripToUse.id);
      }

      // ---- Clear per-record fields after save (keep the trip selection) ----
      inputFlight.value = "";
      inputDate.value = "";
      inputPnr.value = "";
      inputPaxNew.value = "";
      // Clear all selections in the multi-select
      Array.from(selectPaxExisting.options).forEach((opt) => {
        opt.selected = false;
      });
      // Clear new trip name field
      inputTripNew.value = "";

      // Recompute button + errors after clearing
      updateSubmitButtonState();

      // ---- Alert showing what was saved ----
      const flightLabel =
        (record.route && record.route.flightNumber) || flightNumber;
      const depIata =
        record.route &&
        record.route.departure &&
        record.route.departure.iata;
      const arrIata =
        record.route && record.route.arrival && record.route.arrival.iata;
      const routeLabel =
        depIata || arrIata ? ` (${depIata || "?"} → ${arrIata || "?"})` : "";

      const paxList =
        Array.isArray(record.paxNames) && record.paxNames.length > 0
          ? record.paxNames.join(", ")
          : "None";

      let alertMsg =
        `Saved to trip: ${tripToUse.name}\n` +
        `Flight: ${flightLabel}${routeLabel}\n` +
        `Date: ${record.flightDate}\n` +
        `Passengers: ${paxList}`;

      if (record.pnr) {
        alertMsg += `\nPNR: ${record.pnr}`;
      }

      alert(alertMsg);
      // ---------------------------------------------
    } catch (err) {
      console.error("Error saving record:", err);
      outputEl.textContent = JSON.stringify(
        { error: err.message },
        null,
        2
      );
    }
  });

  // Import JSON (upload)
  importBtn.addEventListener("click", () => {
    if (!importFileInput) return;
    importFileInput.value = ""; // allow re-selecting same file
    importFileInput.click();
  });

  importFileInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    try {
      const importedTrips = await importTripsFromFile(file);

      const useImported = window.confirm(
        "Replace current trips with data from this file?"
      );
      if (!useImported) {
        return;
      }

      trips = importedTrips;
      saveTrips(trips);
      renderTrips(trips);
      renderPassengerSelect(trips);
      renderTripSelect(trips);
      alert("Trips file imported successfully.");

      // After import, re-evaluate state (passengers & trips changed)
      updateSubmitButtonState();
    } catch (err) {
      console.error("Import error:", err);
      alert("Could not import file: " + err.message);
    }
  });

  // Download JSON
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

  // Clear all
  clearBtn.addEventListener("click", () => {
    if (!confirm("Clear all trips and flights from this device?")) return;
    trips = [];
    saveTrips(trips);
    renderTrips(trips);
    renderPassengerSelect(trips);
    renderTripSelect(trips);
    updateSubmitButtonState();
  });
});
