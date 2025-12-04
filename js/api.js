// =========================
// API Interactions
// =========================

import { apiState } from "./config.js";
import { normalizeFlightNumber } from "./utils.js";

export async function loadApiKey() {
  try {
    const stored = (localStorage.getItem("apiKeyOverride") || "").trim();
    if (stored) {
      apiState.key = stored;
      return { success: true, message: "API key loaded from local storage." };
    }

    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) {
      return { success: false, message: "config.json not found (status " + res.status + ")." };
    }

    const cfg = await res.json();
    const key = ((cfg && (cfg.AVIATIONSTACK_API_KEY || cfg.apiKey)) || "").trim();

    if (!key) {
      return { success: false, message: "config.json found but no key inside." };
    }

    apiState.key = key;
    return { success: true, message: "API key loaded from config.json." };
  } catch (e) {
    console.error("Error reading config.json:", e);
    return { success: false, message: "Could not read config.json." };
  }
}

export async function fetchRoute(flightNumberRaw) {
  if (!apiState.key) {
    throw new Error("API key is not set. Ensure config.json is present and loaded.");
  }

  const flightNumber = normalizeFlightNumber(flightNumberRaw);
  const url = new URL("https://api.aviationstack.com/v1/flights");
  url.searchParams.set("access_key", apiState.key);
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

  return {
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
}
