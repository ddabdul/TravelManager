// Airport to coordinates mapping (lat/lon).
// Extend this list as needed; keys are IATA codes.
export const airportCoords = {
  // United Kingdom
  BRS: { name: "Bristol Airport", city: "Bristol", lat: 51.3827, lon: -2.7191 },
  LGW: { name: "London Gatwick Airport", city: "London", lat: 51.1537, lon: -0.1821 },
  LHR: { name: "London Heathrow Airport", city: "London", lat: 51.47, lon: -0.4543 },
  LCY: { name: "London City Airport", city: "London", lat: 51.5053, lon: 0.0553 },
  LTN: { name: "London Luton Airport", city: "London", lat: 51.8747, lon: -0.3683 },
  MAN: { name: "Manchester Airport", city: "Manchester", lat: 53.365, lon: -2.272 },

  // Netherlands
  AMS: { name: "Amsterdam Airport Schiphol", city: "Amsterdam", lat: 52.3105, lon: 4.7683 },

  // France
  MRS: { name: "Marseille Provence Airport", city: "Marseille", lat: 43.4393, lon: 5.2214 },
  ORY: { name: "Paris Orly Airport", city: "Paris", lat: 48.7262, lon: 2.3652 },
  CDG: { name: "Paris Charles de Gaulle Airport", city: "Paris", lat: 49.0097, lon: 2.5479 },
  TLS: { name: "Toulouse-Blagnac Airport", city: "Toulouse", lat: 43.6293, lon: 1.3638 },
  NCE: { name: "Nice Côte d'Azur Airport", city: "Nice", lat: 43.6653, lon: 7.215 },

  // Germany
  MUC: { name: "Munich Airport", city: "Munich", lat: 48.3538, lon: 11.7861 },
  FRA: { name: "Frankfurt Airport", city: "Frankfurt", lat: 50.0379, lon: 8.5622 },
  BER: { name: "Berlin Brandenburg Airport", city: "Berlin", lat: 52.3667, lon: 13.5033 },
  HAM: { name: "Hamburg Airport", city: "Hamburg", lat: 53.6304, lon: 9.9882 },
  DUS: { name: "Düsseldorf Airport", city: "Düsseldorf", lat: 51.2895, lon: 6.7668 },
  CGN: { name: "Cologne Bonn Airport", city: "Cologne", lat: 50.8659, lon: 7.1427 },

  // Cyprus
  LCA: { name: "Larnaca International Airport", city: "Larnaca", lat: 34.8751, lon: 33.6249 },
  PFO: { name: "Paphos International Airport", city: "Paphos", lat: 34.7179, lon: 32.4857 },

  // Note: if you have an airport code but no coords here, the map view will skip that leg.
};
