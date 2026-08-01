// KPI calculations and target-band flagging for weekly reports.

export type Flag = "green" | "yellow" | "red" | "na";

export function cpl(spend: number, leads: number): number | null {
  return leads > 0 ? spend / leads : null;
}

export function leadToBooked(booked: number, leads: number): number | null {
  return leads > 0 ? booked / leads : null;
}

export function showRate(shows: number, booked: number): number | null {
  return booked > 0 ? shows / booked : null;
}

// Target bands, named so client health (src/lib/health.ts) reads the same
// numbers the weekly report is flagged against rather than restating them.
export interface Band {
  green: [number, number];
  yellow: [number, number];
}

// CPL target: green $10–35; yellow within ~20% of the band ($8–42); red outside.
export const CPL_BAND: Band = { green: [10, 35], yellow: [8, 42] };

// Lead-to-booked target: green 20–40%; yellow within 5pts (15–45%); red outside.
export const LEAD_TO_BOOKED_BAND: Band = { green: [0.2, 0.4], yellow: [0.15, 0.45] };

// Show rate target: green 50–70%; yellow within 5pts (45–75%); red outside.
export const SHOW_RATE_BAND: Band = { green: [0.5, 0.7], yellow: [0.45, 0.75] };

function bandFlag(value: number | null, band: Band): Flag {
  if (value === null) return "na";
  if (value >= band.green[0] && value <= band.green[1]) return "green";
  if (value >= band.yellow[0] && value <= band.yellow[1]) return "yellow";
  return "red";
}

export function cplFlag(value: number | null): Flag {
  return bandFlag(value, CPL_BAND);
}

export function leadToBookedFlag(value: number | null): Flag {
  return bandFlag(value, LEAD_TO_BOOKED_BAND);
}

export function showRateFlag(value: number | null): Flag {
  return bandFlag(value, SHOW_RATE_BAND);
}

export interface ReportMetrics {
  cpl: number | null;
  cplFlag: Flag;
  leadToBooked: number | null;
  leadToBookedFlag: Flag;
  showRate: number | null;
  showRateFlag: Flag;
  hasRed: boolean;
}

export function computeMetrics(r: {
  spend: number;
  leads: number;
  booked: number;
  shows: number;
}): ReportMetrics {
  const c = cpl(r.spend, r.leads);
  const l2b = leadToBooked(r.booked, r.leads);
  const sr = showRate(r.shows, r.booked);
  const flags = [cplFlag(c), leadToBookedFlag(l2b), showRateFlag(sr)];
  return {
    cpl: c,
    cplFlag: flags[0],
    leadToBooked: l2b,
    leadToBookedFlag: flags[1],
    showRate: sr,
    showRateFlag: flags[2],
    hasRed: flags.includes("red"),
  };
}
