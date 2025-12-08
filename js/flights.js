import { airportToCountry } from "./airportCountries.js";

function mapAirportToCountry(code) {
  if (!code) return "Other";
  const upper = String(code).toUpperCase();
  return airportToCountry[upper] || "Other";
}

// Return flights for a passenger; if passengerName is null, return all flights.
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
      const depIso = dep.scheduled || null;
      const arrIso = arr.scheduled || null;

      flights.push({
        date,
        flightNumber: (rec.route.flightNumber || rec.flightNumber || "").toString(),
        airline: rec.route.airline || null,
        tripId: trip.id,
        recordId: rec.id,
        pnr: rec.pnr || "",
        departureCode: depCode,
        arrivalCode: arrCode,
        departureName: depName,
        arrivalName: arrName,
        departureTime: depIso,
        arrivalTime: arrIso,
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
