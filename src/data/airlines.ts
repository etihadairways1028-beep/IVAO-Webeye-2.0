// ICAO airline designators for the airlines most often flown on the network.
// Unknown codes still work everywhere; they just show the code instead of a name.
export const AIRLINES: Record<string, string> = {
  AAL: 'American Airlines', ABY: 'Air Arabia', ACA: 'Air Canada', AEA: 'Air Europa', AEE: 'Aegean Airlines', AFL: 'Aeroflot', AFR: 'Air France', AIC: 'Air India', AMX: 'Aeroméxico', ANA: 'All Nippon Airways',
  ANZ: 'Air New Zealand', ASA: 'Alaska Airlines', AUA: 'Austrian Airlines', AVA: 'Avianca', AXM: 'AirAsia', AZU: 'Azul', BAW: 'British Airways', BEL: 'Brussels Airlines', BTI: 'airBaltic', CAL: 'China Airlines',
  CCA: 'Air China', CES: 'China Eastern', CLX: 'Cargolux', CMP: 'Copa Airlines', CPA: 'Cathay Pacific', CSN: 'China Southern', DAL: 'Delta Air Lines', DLH: 'Lufthansa', EIN: 'Aer Lingus', ELY: 'El Al',
  ETD: 'Etihad Airways', ETH: 'Ethiopian Airlines', EVA: 'EVA Air', EWG: 'Eurowings', EZY: 'easyJet', FDB: 'flydubai', FDX: 'FedEx', FFT: 'Frontier Airlines', FIN: 'Finnair', GFA: 'Gulf Air',
  GIA: 'Garuda Indonesia', GLO: 'Gol', GTI: 'Atlas Air', HAL: 'Hawaiian Airlines', IBE: 'Iberia', ICE: 'Icelandair', IGO: 'IndiGo', ITY: 'ITA Airways', JAL: 'Japan Airlines', JBU: 'JetBlue',
  JST: 'Jetstar', KAC: 'Kuwait Airways', KAL: 'Korean Air', KLM: 'KLM', KQA: 'Kenya Airways', LAN: 'LATAM', LOT: 'LOT Polish Airlines', MAS: 'Malaysia Airlines', MSR: 'EgyptAir', NAX: 'Norwegian',
  NKS: 'Spirit Airlines', OMA: 'Oman Air', PAL: 'Philippine Airlines', PGT: 'Pegasus', PIA: 'Pakistan International', QFA: 'Qantas', QTR: 'Qatar Airways', RAM: 'Royal Air Maroc', RJA: 'Royal Jordanian', RYR: 'Ryanair',
  SAA: 'South African Airways', SAS: 'SAS', SIA: 'Singapore Airlines', SVA: 'Saudia', SWA: 'Southwest Airlines', SWR: 'Swiss', TAM: 'LATAM Brasil', TAP: 'TAP Air Portugal', THA: 'Thai Airways', THY: 'Turkish Airlines',
  TOM: 'TUI Airways', UAE: 'Emirates', UAL: 'United Airlines', UPS: 'UPS Airlines', VIR: 'Virgin Atlantic', VLG: 'Vueling', VNA: 'Vietnam Airlines', VOI: 'Volaris', VOZ: 'Virgin Australia', WJA: 'WestJet',
  WZZ: 'Wizz Air', FAD: 'flyadeal', KNE: 'flynas', JZR: 'Jazeera Airways', SEJ: 'SpiceJet', AXB: 'Air India Express', CXA: 'Xiamen Airlines', HVN: 'Vietnam Airlines', AAR: 'Asiana Airlines', TVF: 'Transavia France',
};

/** Airline code of a callsign (first three letters when followed by a digit), else null. */
export function airlineOf(callsign: string): string | null {
  const m = /^([A-Z]{3})\d/.exec(callsign.toUpperCase());
  return m ? m[1] : null;
}

export const airlineName = (code: string) => AIRLINES[code] ?? null;
