// =========================
// Config & storage
// =========================

const STORAGE_KEY = "flightRecords";
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

function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records, null, 2));
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

function renderRecords(records) {
  const savedEl = document.getElementById("saved-json");
  savedEl.textContent = JSON.stringify(records, null, 2);
}

function getPassengerList(records) {
  const allNames = [];
  for (const rec of records) {
    if (Array.isArray(rec.paxNames)) {
      allNames.push(...rec.paxNames);
    }
  }
  const unique = normalizePassengerNames(allNames);
  unique.sort((a, b) => a.localeCompare(b));
  return unique;
}

function renderPassengerSelect(records) {
  const select = document.getElementById("pax-existing");
  const passengers = getPassengerList(records);

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

    // Exact same date
    if (rec.flightDate && flightDate && rec.flightDate === flightDate) {
      return rec.route;
    }

    if (!fallbackRoute) {
      fallbackRoute = rec.route;
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
 * Import records from a JSON file.
 * The file must contain an array of record objects.
 */
async function importRecordsFromFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error("File is not valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Expected an array of records in the JSON (array).");
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

  const importBtn = document.getElementById("import-json");
  const importFileInput = document.getElementById("import-json-file");
  const downloadBtn = document.getElementById("download-json");
  const clearBtn = document.getElementById("clear-json");

  console.log("Flight Log app script loaded");

  let records = loadRecords();
  renderRecords(records);
  renderPassengerSelect(records);

  updateApiKeyStatus("Loading API key from config.json…");
  loadApiKeyFromConfigJson();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const flightNumberRaw = inputFlight.value.trim();
    const flightDate = inputDate.value;
    const pnrRaw = inputPnr.value.trim();
    const paxNewRaw = inputPaxNew.value.trim();

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

    const flightNumber = flightNumberRaw; // keep original spacing for display
    const cachedRoute = findCachedRoute(records, flightNumber, flightDate);
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
      const selectedExisting = Array.from(
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
        ...selectedExisting,
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

      records.push(record);
      saveRecords(records);
      renderRecords(records);
      renderPassengerSelect(records);
      inputPaxNew.value = "";
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
      const importedRecords = await importRecordsFromFile(file);

      const useImported = window.confirm(
        "Replace current log with data from this file?"
      );
      if (!useImported) {
        return;
      }

      records = importedRecords;
      saveRecords(records);
      renderRecords(records);
      renderPassengerSelect(records);
      alert("Travel file imported successfully.");
    } catch (err) {
      console.error("Import error:", err);
      alert("Could not import file: " + err.message);
    }
  });

  // Download JSON
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

  // Clear all
  clearBtn.addEventListener("click", () => {
    if (!confirm("Clear all saved flights from this device?")) return;
    records = [];
    saveRecords(records);
    renderRecords(records);
    renderPassengerSelect(records);
  });
});
