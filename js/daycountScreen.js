import { getAllPassengers } from "./data.js";
import { calculateDaysByCountry, getPassengerYears } from "./daycount.js";

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function renderDaycountView({ trips, daycountState, els }) {
  const passSelect = els["daycount-passenger"];
  const yearList = els["daycount-year-list"];
  const resultsEl = els["daycount-results"];
  const emptyEl = els["daycount-empty"];
  const upcomingList = els["daycount-upcoming-list"];
  const upcomingEmpty = els["daycount-upcoming-empty"];
  if (!passSelect || !yearList || !resultsEl || !emptyEl) return;

  const passengers = getAllPassengers(trips);
  passSelect.innerHTML = '<option value="">Select passenger</option>';
  passengers.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    if (p === daycountState.passenger) opt.selected = true;
    passSelect.appendChild(opt);
  });

  if (!passengers.includes(daycountState.passenger)) {
    daycountState.passenger = "";
    daycountState.monthSelection = null;
  }

  if (!daycountState.passenger) {
    emptyEl.textContent = passengers.length ? "Choose a passenger to view days by country." : "No passengers yet.";
    emptyEl.classList.remove("hidden");
    resultsEl.innerHTML = "";
    yearList.innerHTML = "";
    if (upcomingList) upcomingList.innerHTML = "";
    if (upcomingEmpty) upcomingEmpty.classList.remove("hidden");
    return;
  }

  const years = getPassengerYears(trips, daycountState.passenger);
  if (!years.length) {
    emptyEl.textContent = "No travel data for this passenger.";
    emptyEl.classList.remove("hidden");
    resultsEl.innerHTML = "";
    yearList.innerHTML = "";
    return;
  }

  if (!years.includes(daycountState.year)) {
    daycountState.year = years[0];
    daycountState.monthSelection = null;
  }

  yearList.innerHTML = years.map((y) => {
    const active = y === daycountState.year ? "active" : "";
    return `<button class="chip-button ${active}" data-year="${y}">${y}</button>`;
  }).join("");

  const { countries, rangesByCountry } = calculateDaysByCountry(trips, daycountState.passenger, daycountState.year);
  const countryNames = Object.keys(countries || {}).sort();
  if (!countryNames.length) {
    emptyEl.textContent = "No travel data for this year.";
    emptyEl.classList.remove("hidden");
    resultsEl.innerHTML = "";
    return;
  }

  const selection = daycountState.monthSelection;
  let selectedCountry = selection?.country || "";
  let selectedMonth = typeof selection?.monthIndex === "number" ? selection.monthIndex : null;

  if (!selectedCountry || selectedMonth === null || selectedMonth < 0 || selectedMonth > 11 || !countries[selectedCountry]) {
    daycountState.monthSelection = null;
    selectedCountry = "";
    selectedMonth = null;
  }

  emptyEl.classList.add("hidden");
  resultsEl.innerHTML = countryNames.map((country) => {
    const months = countries[country] || [];
    const total = months.reduce((a, b) => a + (b || 0), 0);
    const monthCells = monthLabels.map((label, idx) => {
      const days = months[idx] || 0;
      const cls = days === 0 ? 'class="value zero"' : 'class="value"';
      const active = selectedCountry === country && selectedMonth === idx ? "active" : "";
      return `
        <button type="button" class="daycount-month ${active}" data-country="${country}" data-month="${idx}">
          <div class="label">${label}</div>
          <div ${cls}>${days}</div>
        </button>`;
    }).join("");

    let detailHtml = "";
    if (selectedCountry === country && selectedMonth !== null) {
      const ranges = rangesByCountry?.[country]?.[selectedMonth] || [];
      const monthDaysTotal = new Date(Date.UTC(daycountState.year, selectedMonth + 1, 0)).getUTCDate();
      const monthTotal = months[selectedMonth] || 0;
      if (monthTotal < monthDaysTotal) {
        const formatPlace = (label, country) => {
          if (label && country) return `${label}, ${country}`;
          return label || country || "";
        };
        const buildLegText = (label, day, airport, other, otherCountry, connector) => {
          if (!day) return "";
          const airportText = airport || "Unknown";
          let text = `${label} ${day}: ${airportText}`;
          const placeText = formatPlace(other, otherCountry);
          if (placeText) {
            text += ` ${connector} ${placeText}`;
          }
          return text;
        };
        const rangesHtml = ranges.length
          ? ranges.map((range) => {
              const entryText = buildLegText(
                "Entry",
                range.entryDay,
                range.entryAirportLabel,
                range.entryFromLabel,
                range.entryFromCountry,
                "from"
              );
              const exitText = buildLegText(
                "Exit",
                range.exitDay,
                range.exitAirportLabel,
                range.exitToLabel,
                range.exitToCountry,
                "to"
              );
              const parts = [entryText, exitText].filter(Boolean);
              return `<span class="daycount-range">${parts.join(" • ")}</span>`;
            }).join("")
          : `<span class="daycount-range daycount-range-empty">No stay recorded</span>`;
        detailHtml = `
          <div class="daycount-month-detail">
            <span class="daycount-month-detail-label">${monthLabels[selectedMonth]}</span>
            ${rangesHtml}
          </div>
        `;
      }
    }
    return `
      <div class="daycount-country">
        <div class="daycount-country-header">
          <span>${country}</span>
          <span class="daycount-country-total">${total} days</span>
        </div>
        <div class="daycount-months">
          ${monthCells}
        </div>
        ${detailHtml}
      </div>
    `;
  }).join("");
}

