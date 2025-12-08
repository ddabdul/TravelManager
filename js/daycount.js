// =========================
// Day Count Helpers (per-passenger, per-country, per-month)
// =========================

import { airportToCountry } from "./airportCountries.js";

function mapAirportToCountry(code) {
  if (!code) return "Other";
  const upper = String(code).toUpperCase();
  return airportToCountry[upper] || "Other";
}

export function getPassengerFlights(trips, passengerName) {
  const includeAll = passengerName === null;
  if (!includeAll && !passengerName) return [];
  const flights = [];
  for (const trip of trips || []) {
    if (!trip || !Array.isArray(trip.records)) continue;
    for (const rec of trip.records) {
      if (!rec || !rec.route) continue;
      const pax = Array.isArray(rec.paxNames) ? rec.paxNames.map((p) => String(p || "").trim()) : [];
      if (!includeAll && !pax.includes(passengerName)) continue;

      const dep = rec.route.departure || {};
      const arr = rec.route.arrival || {};
      const depDate = dep.scheduled || rec.flightDate || rec.createdAt;
      const date = depDate ? new Date(depDate) : null;
      if (!date || isNaN(date.getTime())) continue;

      const depCode = dep.iata || dep.icao || null;
      const arrCode = arr.iata || arr.icao || null;
      const depName = dep.airport || depCode || "";
      const arrName = arr.airport || arrCode || "";

      flights.push({
        date,
        flightNumber: (rec.route.flightNumber || rec.flightNumber || "").toString(),
        airline: rec.route.airline || null,
        tripId: trip.id,
        recordId: rec.id,
        departureCode: depCode,
        arrivalCode: arrCode,
        departureName: depName,
        arrivalName: arrName,
        departureCountry: mapAirportToCountry(depCode),
        arrivalCountry: mapAirportToCountry(arrCode),
        paxNames: pax
      });
    }
  }
  flights.sort((a, b) => a.date - b.date);
  return flights;
}

export function getUpcomingFlights(trips, passengerName) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return getPassengerFlights(trips, passengerName).filter((f) => f.date >= today);
}

export function getPassengerYears(trips, passengerName) {
  const years = new Set();
  for (const f of getPassengerFlights(trips, passengerName)) {
    years.add(f.date.getFullYear());
  }
  return Array.from(years).sort((a, b) => a - b);
}

export function calculateDaysByCountry(trips, passengerName, year) {
  const flights = getPassengerFlights(trips, passengerName);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  if (!flights.length) {
    return { countries: {}, years: [] };
  }

  // Determine country at year start by simulating all flights up to the year boundary.
  let currentCountry = flights[0].departureCountry || "Other";
  for (const f of flights) {
    if (f.date < yearStart) {
      // Move to arrival country if different.
      if (f.arrivalCountry) currentCountry = f.arrivalCountry;
    } else {
      break;
    }
  }

  let cursor = new Date(yearStart);
  const stays = [];
  for (const f of flights) {
    if (f.date < yearStart) continue;
    if (f.date >= yearEnd) break;

    // Close current stay up to flight departure
    stays.push({ country: currentCountry, start: new Date(cursor), end: new Date(f.date) });

    // Move to arrival country (if differs)
    if (f.arrivalCountry) currentCountry = f.arrivalCountry;
    cursor = new Date(f.date);
  }

  // Final stay to year end
  stays.push({ country: currentCountry, start: new Date(cursor), end: new Date(yearEnd) });

  // Aggregate days per country/month
  const countries = {};
  for (const stay of stays) {
    const country = stay.country || "Other";
    if (!countries[country]) {
      countries[country] = Array(12).fill(0);
    }
    let ptr = new Date(stay.start);
    while (ptr < stay.end) {
      const monthEnd = new Date(Date.UTC(ptr.getUTCFullYear(), ptr.getUTCMonth() + 1, 1));
      const sliceEnd = monthEnd < stay.end ? monthEnd : stay.end;
      const days = Math.ceil((sliceEnd - ptr) / (1000 * 60 * 60 * 24));
      countries[country][ptr.getUTCMonth()] += days;
      ptr = sliceEnd;
    }
  }

  return { countries, years: getPassengerYears(trips, passengerName) };
}
