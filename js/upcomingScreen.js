import { getAllPassengers } from "./data.js";
import { getUpcomingFlights } from "./flights.js";
import { formatDateTimeLocal, extractTime } from "./utils.js";

export function renderUpcomingScreen({ trips, upcomingState, els }) {
  const listEl = els["upcoming-list"];
  const emptyEl = els["upcoming-empty"];
  const passSelect = els["upcoming-passenger"];
  if (!listEl || !emptyEl) return;

  // Populate passengers
  const passengers = getAllPassengers(trips);
  if (passSelect) {
    passSelect.innerHTML = '<option value="">All passengers</option>';
    passengers.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      if (p === upcomingState.passenger) opt.selected = true;
      passSelect.appendChild(opt);
    });
    // If stored passenger no longer exists, reset
    if (upcomingState.passenger && !passengers.includes(upcomingState.passenger)) {
      upcomingState.passenger = "";
      passSelect.value = "";
    }
  }

  const filterPax = passSelect ? (passSelect.value || upcomingState.passenger || "") : upcomingState.passenger;
  if (filterPax !== undefined) upcomingState.passenger = filterPax;
  const filterValue = filterPax === "" ? null : filterPax;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const allFlights = getUpcomingFlights(trips, filterValue)
    .map((f) => ({ ...f }))
    .filter((f) => f.date >= today);

  const depMs = (f) => {
    const src = f.departureTime || (typeof f.date === "string" ? `${f.date}T00:00:00` : f.date);
    const d = new Date(src);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  };

  if (!allFlights.length) {
    emptyEl.classList.remove("hidden");
    listEl.innerHTML = "";
    return;
  }

  // Group connecting flights by same PNR and departure day
  const groupsMap = new Map();
  const singles = [];

  allFlights.forEach((f) => {
    const pnrKey = (f.pnr || "").trim();
    const depIso = f.departureTime || f.date;
    const d = depIso ? new Date(depIso) : null;
    const dayKey = d && !isNaN(d) ? d.toISOString().slice(0, 10) : "";
    if (pnrKey && dayKey) {
      const key = `${dayKey}__${pnrKey}`;
      if (!groupsMap.has(key)) groupsMap.set(key, []);
      groupsMap.get(key).push(f);
    } else {
      singles.push(f);
    }
  });

  const buckets = [];
  groupsMap.forEach((arr) => {
    const legs = arr.slice().sort((a, b) => depMs(a) - depMs(b));
    const sortKey = depMs(legs[0]);
    buckets.push({ sortKey, legs });
  });
  singles.forEach((f) => buckets.push({ sortKey: depMs(f), legs: [f] }));

  buckets.sort((a, b) => a.sortKey - b.sortKey);

  const tiles = buckets.map(({ legs }) => {
    const first = legs[0];
    const isGroup = legs.length > 1;
    const dateLabel = formatDateTimeLocal(first.departureTime || first.date);
    const fn = first.flightNumber || "Flight";
    const pnr = first.pnr || "";
    const pax = Array.from(new Set(legs.flatMap((l) => l.paxNames || []))).join(", ");
    const pnrSpan = pnr ? `<span class="pnr-text">PNR: ${pnr}</span>` : "";
    const paxSpan = pax ? `<span class="pax-text">Pax: ${pax}</span>` : "";
    const infoLine = [pnrSpan, paxSpan].filter(Boolean).join(" · ");

    const segments = legs.map((f) => {
      const depTime = f.departureTime ? extractTime(f.departureTime) : "";
      const arrTime = f.arrivalTime ? extractTime(f.arrivalTime) : "";
      const depName = f.departureName || f.departureCode || "?";
      const arrName = f.arrivalName || f.arrivalCode || "?";
      const depCode = f.departureCode || (depName ? depName.slice(0, 3).toUpperCase() : "?");
      const arrCode = f.arrivalCode || (arrName ? arrName.slice(0, 3).toUpperCase() : "?");
      return `
        <div class="segment-main-row" style="padding:6px 0;">
          <div class="segment-side">
            <div class="segment-city">
              <span class="mobile-hide">${depName}</span>
              <span class="mobile-only">${depCode}</span>
            </div>
            <div class="segment-code-time">
              <span class="segment-time">${depTime}</span>
            </div>
          </div>
          <div class="segment-arrow">
            <span class="segment-icon segment-icon-flight" aria-hidden="true">✈︎</span>
          </div>
          <div class="segment-side segment-side-right">
            <div class="segment-city">
              <span class="mobile-hide">${arrName}</span>
              <span class="mobile-only">${arrCode}</span>
            </div>
            <div class="segment-code-time">
              <span class="segment-time">${arrTime}</span>
            </div>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="flight-tile itinerary-tile">
        <div class="flight-tile-header">
          <div class="flight-tile-header-left">
            <span class="event-type-icon event-type-icon-flight">✈︎</span>
            <span class="flight-date">${dateLabel}</span>
          </div>
          <span class="flight-airline">${fn}</span>
        </div>
        <div class="itinerary-body">
          <div class="itinerary-segment segment-flight">
            <div class="segment-header-row">
              <span class="segment-label mobile-hide">${isGroup ? "Connecting" : "Upcoming"}</span>
              <span class="segment-flight-code">${infoLine}</span>
            </div>
            ${segments}
          </div>
        </div>
      </div>
    `;
  });

  emptyEl.classList.add("hidden");
  listEl.innerHTML = tiles.join("");
}
