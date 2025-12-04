// =========================
// Data Transformation & Business Logic
// =========================

import { normalizePassengerNames, normalizeFlightNumber } from "./utils.js";

export function getAllPassengers(trips) {
  const all = [];
  for (const trip of trips) {
    if (!trip) continue;
    if (Array.isArray(trip.records)) {
      for (const rec of trip.records) {
        if (Array.isArray(rec.paxNames)) all.push(...rec.paxNames);
      }
    }
    if (Array.isArray(trip.hotels)) {
      for (const h of trip.hotels) {
        if (Array.isArray(h.paxNames)) all.push(...h.paxNames);
      }
    }
  }
  const unique = normalizePassengerNames(all);
  unique.sort((a, b) => a.localeCompare(b));
  return unique;
}

export function getAllHotelNames(trips) {
  const set = new Set();
  for (const trip of trips) {
    if (!trip || !Array.isArray(trip.hotels)) continue;
    for (const h of trip.hotels) {
      if (h && typeof h.hotelName === "string" && h.hotelName.trim()) {
        set.add(h.hotelName.trim());
      }
    }
  }
  const names = Array.from(set);
  names.sort((a, b) => a.localeCompare(b));
  return names;
}

export function findCachedRoute(trips, flightNumberRaw, flightDate) {
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

// Build combined timeline grouped by day.
export function buildTripEvents(trip) {
  if (!trip) return [];

  const groups = new Map();

  // 1. Group flights
  if (Array.isArray(trip.records)) {
    for (const rec of trip.records) {
      if (!rec) continue;

      const route = rec.route || {};
      const dep = route.departure || {};
      const depIso = dep.scheduled;

      let baseSort;
      if (depIso) {
        baseSort = depIso; 
      } else if (rec.flightDate) {
        baseSort = rec.flightDate + "T00:00:00";
      } else {
        baseSort = rec.createdAt || "";
      }

      const hasPnrAndDate = rec.pnr && rec.flightDate;
      const key = hasPnrAndDate
        ? `PNR__${rec.flightDate}__${rec.pnr}`
        : `FLIGHT__${rec.id}`;

      let group = groups.get(key);
      if (!group) {
        group = {
          type: "flightGroup",
          flightDate: rec.flightDate || null,
          pnr: rec.pnr || null,
          records: [],
          sortKey: baseSort
        };
        groups.set(key, group);
      }

      group.records.push(rec);

      if (!group.sortKey || (baseSort && baseSort < group.sortKey)) {
        group.sortKey = baseSort;
      }
    }
  }

  // 2. Build days
  const dayMap = new Map();

  function ensureDay(dateKey) {
    const key = dateKey || "";
    let day = dayMap.get(key);
    if (!day) {
      day = {
        type: "day",
        date: key || null,
        flights: [],
        hotels: [],
        sortKey: key ? key + "T00:00:00" : ""
      };
      dayMap.set(key, day);
    }
    return day;
  }

  for (const group of groups.values()) {
    const dateKey =
      (group.flightDate && group.flightDate.slice(0, 10)) ||
      (group.sortKey ? group.sortKey.slice(0, 10) : "");

    const day = ensureDay(dateKey);
    day.flights.push(group);

    if (!day.sortKey || (group.sortKey && group.sortKey < day.sortKey)) {
      day.sortKey = group.sortKey || day.sortKey;
    }
  }

  // Hotels -> days
  if (Array.isArray(trip.hotels)) {
    for (const h of trip.hotels) {
      if (!h || typeof h !== "object") continue;

      let datePart = "";
      if (h.checkInDate) {
        datePart = h.checkInDate;
      } else if (h.createdAt) {
        datePart = String(h.createdAt).slice(0, 10);
      }

      const sortKey = datePart ? `${datePart}T00:00:00` : h.createdAt || "";
      const day = ensureDay(datePart);
      day.hotels.push({
        type: "hotel",
        hotel: h,
        sortKey
      });

      if (!day.sortKey || (sortKey && sortKey < day.sortKey)) {
        day.sortKey = sortKey;
      }
    }
  }

  const days = Array.from(dayMap.values());

  // Sort internal events
  for (const day of days) {
    day.flights.sort((a, b) => (a.sortKey || "").localeCompare(b.sortKey || ""));
    day.hotels.sort((a, b) => (a.sortKey || "").localeCompare(b.sortKey || ""));
  }

  // Sort days
  days.sort((a, b) => {
    const da = a.date || "";
    const db = b.date || "";
    if (da && db && da !== db) return da.localeCompare(db);
    return (a.sortKey || "").localeCompare(b.sortKey || "");
  });

  return days;
}