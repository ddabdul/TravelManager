// =========================
// Day Count Helpers (per-passenger, per-country, per-month)
// =========================

// Minimal airport -> country map; extend as needed.
const airportToCountry = {
  // UK
  BRS: "United Kingdom", LGW: "United Kingdom", LHR: "United Kingdom", LCY: "United Kingdom",
  LTN: "United Kingdom", LCJ: "United Kingdom", MAN: "United Kingdom",
  // Netherlands
  AMS: "Netherlands",
  // France
  MRS: "France", ORY: "France", CDG: "France", TLS: "France", NCE: "France",
  // Germany
  MUC: "Germany", FRA: "Germany", BER: "Germany", HAM: "Germany", DUS: "Germany", CGN: "Germany",
  // Cyprus
  LCA: "Cyprus", PFO: "Cyprus"
};

function mapAirportToCountry(code) {
  if (!code) return null;
  const upper = String(code).toUpperCase();
  return airportToCountry[upper] || null;
}

export function getPassengerFlights(trips, passengerName) {
  if (!passengerName) return [];
  const flights = [];
  for (const trip of trips || []) {
    if (!trip || !Array.isArray(trip.records)) continue;
    for (const rec of trip.records) {
      if (!rec || !rec.route) continue;
      const pax = Array.isArray(rec.paxNames) ? rec.paxNames.map((p) => String(p || "").trim()) : [];
      if (!pax.includes(passengerName)) continue;

      const dep = rec.route.departure || {};
      const arr = rec.route.arrival || {};
      const depDate = dep.scheduled || rec.flightDate || rec.createdAt;
      const date = depDate ? new Date(depDate) : null;
      if (!date || isNaN(date.getTime())) continue;

      const depCode = dep.iata || dep.icao || null;
      const arrCode = arr.iata || arr.icao || null;

      flights.push({
        date,
        departureCode: depCode,
        arrivalCode: arrCode,
        departureCountry: mapAirportToCountry(depCode) || `Unknown (${depCode || "-"})`,
        arrivalCountry: mapAirportToCountry(arrCode) || `Unknown (${arrCode || "-"})`
      });
    }
  }
  flights.sort((a, b) => a.date - b.date);
  return flights;
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
  let currentCountry = flights[0].departureCountry || "Unknown";
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
    const country = stay.country || "Unknown";
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
