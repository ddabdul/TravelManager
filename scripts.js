// =========================
// Config & storage
// =========================

const STORAGE_KEY = "flightRecords";
const API_KEY_STORAGE_KEY = "flightLogApiKey";
let API_KEY = null; // will be loaded from a local file or storage

/**
 * Normalise & deduplicate passenger names:
 * - trim
 * - collapse multiple spaces
 * - dedupe ignoring case (John Doe == john doe)
 */
function normalizePassengerNames(names) {
  const map = new Map(); // key = lowercased name, value = first "nice" version

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

/**
 * Normalize flight number: remove spaces, uppercase.
 * e.g. "lh 438" -> "LH438"
 */
function normalizeFlightNumber(flightNumber) {
  if (!flightNumber || typeof flightNumber !== "string") return "";
  return flightNumber.replace(/\s+/g, "").toUpperCase();
}

/**
 * Load all saved flight records from localStorage.
 */
function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("Failed to parse stored records", e);
    return [];
  }
}

/**
 * Save all flight records to localStorage.
 */
function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records, null, 2));
}

/**
 * Load API key from localStorage (if previously saved).
 */
function loadApiKeyFromStorage() {
  try {
    const key = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (key && typeof key === "string" && key.trim() !== "") {
      API_KEY = key.trim();
    }
  } catch (e) {
    console.error("Failed to load API key from storage", e);
  }
}

/**
 * Save API key to localStorage for convenience (still only on this device).
 */
function saveApiKeyToStorage(key) {
  try {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
  } catch (e) {
    console.error("Failed to save API key to storage", e);
  }
}

/**
 * Update small status text under the API key file input.
 */
function updateApiKeyStatus(messageOverride) {
  const statusEl = document.getElementById("api-key-status");
  if (!statusEl) return;

  if (messageOverride) {
    statusEl.textContent = messageOverride;
    return;
  }

  if (API_KEY) {
    statusEl.textContent = "API key loaded.";
  } else {
    statusEl.textContent = "No API key loaded yet.";
  }
}

/**
 * Read an API key from a user-selected file.
 * Supports:
 *  - Plain text: file contains only the key
 *  - JSON: { "AVIATIONSTACK_API_KEY": "..." } or { "apiKey": "..." }
 */
async function loadApiKeyFromFile(file) {
  const text = await file.text();
  let key = text.trim();

  // Try JSON first
  try {
    const json = JSON.parse(text);
    if (json && (json.AVIATIONSTACK_API_KEY || json.apiKey)) {
      key = String(json.AVIATIONSTACK_API_KEY || json.apiKey).trim();
    }
  } catch (e) {
    // Not JSON, that's fine, we treat it as plain text
  }

  if (!key) {
    throw new Error("No API key found in file.");
  }

  API_KEY = key;
  saveApiKeyToStorage(key);
  updateApiKeyStatus();
}

/**
 * Show the full JSON in the <pre>.
 */
function renderRecords(records) {
  const savedEl = document.getElementById("saved-json");
  savedEl.textContent = JSON.stringify(records, null, 2);
}

/**
 * Build a unique, sorted list of passenger names from all records.
 * A passenger appearing in many records will only appear once.
 */
function getPassengerList(records) {
  // Collect all names from all records
  const allNames = [];
  for (const rec of records) {
    if (Array.isArray(rec.paxNames)) {
      allNames.push(...rec.paxNames);
    }
  }

  // Normalise & dedupe across all records
  const unique = normalizePassengerNames(allNames);

  // Sort alphabetically
  unique.sort((a, b) => a.localeCompare(b));

  return unique;
}

/**
 * Render passenger names into the <select multiple>.
 * Ensures each name appears only once.
 */
function renderPassengerSelect(records) {
  const select = document.getElementById("pax-existing");
  const passengers = getPassengerList(records);

  // Clear existing options
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

/**
 * Look for an existing route for this flight in the saved records.
 * First try exact match on (normalized flight number + same date),
 * then fall back to any record with the same flight number.
 */
function findCachedRoute(records, flightNumberRaw, flightDate) {
  const normTarget = normalizeFlightNumber(flightNumberRaw);
  if (!normTarget) return null;

  let fallbackRoute = null;

  for (const rec of records) {
    if (!rec || !rec.route) continue;

    const recFlightNum =
      (rec.route.flightNumber && String(rec.route.flightNumber)) || "";
    const normRec = normalizeFlightNumber(recFlightNum);

    if (!normRec || normRec !== normTarget) continue;

    // Perfect match: same flight number + same date
    if (rec.flightDate && flightDate && rec.flightDate === flightDate) {
      return rec.route;
    }

    // Remember at least one route for this flight number
    if (!fallbackRoute) {
      fallbackRoute = rec.route;
    }
  }

  return fallbackRoute;
}

/**
 * Call aviationstack to get the route for a flight number.
 */
async function fetchRoute(flightNumberRaw) {
  if (!API_KEY) {
    throw new Error("API key is not set. Load it from a local file first.");
  }

  // Normalize the flight number: remove spaces & uppercase
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

  // Take the first matching flight
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
  const downloadBtn = document.getElementById("download-json");
  const clearBtn = document.getElementById("clear-json");
  const apiKeyFileInput = document.getElementById("api-key-file");

  let records = loadRecords();
  renderRecords(records);
  renderPassengerSelect(records);

  // Load any previously stored API key
  loadApiKeyFromStorage();
  updateApiKeyStatus();

  // When user selects a local file containing the API key
  if (apiKeyFileInput) {
    apiKeyFileInput.addEventListener("change", async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      updateApiKeyStatus("Reading API key from file...");
      try {
        await loadApiKeyFromFile(file);
      } catch (err) {
        console.error(err);
        updateApiKeyStatus("Error loading API key: " + err.message);
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const flightNumber = inputFlight.value.trim();
    const flightDate = inputDate.value; // YYYY-MM-DD
    const pnrRaw = inputPnr.value.trim();
    const paxNewRaw = inputPaxNew.value.trim();

    if (!flightNumber) {
      outputEl.textContent = JSON.stringify(
        { error: "Please enter a flight number." },
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

    // 1) Try to find a cached route in existing records
    const cachedRoute = findCachedRoute(records, flightNumber, flightDate);

    let route;

    try {
      if (cachedRoute) {
        // Build a human-friendly summary of the cached route for the confirm dialog
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
          route = cachedRoute;
          outputEl.textContent = JSON.stringify(
            { ...route, _source: "cache" },
            null,
            2
          );
        } else {
          // Proceed with API call
          outputEl.textContent = JSON.stringify(
            { status: "Loading route from API..." },
            null,
            2
          );
          route = await fetchRoute(flightNumber);
          outputEl.textContent = JSON.stringify(route, null, 2);
        }
      } else {
        // No cached route: go straight to API
        outputEl.textContent = JSON.stringify(
          { status: "Loading route from API..." },
          null,
          2
        );
        route = await fetchRoute(flightNumber);
        outputEl.textContent = JSON.stringify(route, null, 2);
      }
    } catch (err) {
      outputEl.textContent = JSON.stringify({ error: err.message }, null, 2);
      return;
    }

    try {
      // Existing passenger selections
      const selectedExisting = Array.from(
        selectPaxExisting.selectedOptions || []
      )
        .map((opt) => opt.value)
        .filter(Boolean);

      // New passenger names (comma-separated)
      const newNames = paxNewRaw
        ? paxNewRaw
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean)
        : [];

      // Merge + normalise + dedupe for THIS record
      const paxNames = normalizePassengerNames([
        ...selectedExisting,
        ...newNames
      ]);

      const record = {
        id: Date.now(), // simple unique id
        createdAt: new Date().toISOString(),
        flightDate: flightDate, // as given by the date input
        pnr: pnrRaw ? pnrRaw.toUpperCase() : null,
        paxNames: paxNames,
        route: route
      };

      records.push(record);
      saveRecords(records);
      renderRecords(records);
      renderPassengerSelect(records); // updates global list, keeping each name once

      // Optional: clear only the "new pax" field, keep selections
      inputPaxNew.value = "";
    } catch (err) {
      // If something fails after we already printed the route, show the error too
      outputEl.textContent = JSON.stringify(
        { error: err.message },
        null,
        2
      );
    }
  });

  downloadBtn.addEventListener("click", () => {
    const dataStr = JSON.stringify(records, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "flights.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  clearBtn.addEventListener("click", () => {
    if (!confirm("Clear all saved flights from this device?")) return;
    records = [];
    saveRecords(records);
    renderRecords(records);
    renderPassengerSelect(records);
  });
});
