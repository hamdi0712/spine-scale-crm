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

function bandFlag(
  value: number | null,
  greenLo: number,
  greenHi: number,
  yellowLo: number,
  yellowHi: number
): Flag {
  if (value === null) return "na";
  if (value >= greenLo && value <= greenHi) return "green";
  if (value >= yellowLo && value <= yellowHi) return "yellow";
  return "red";
}

// CPL target: green $10–35; yellow within ~20% of the band ($8–42); red outside.
export function cplFlag(value: number | null): Flag {
  return bandFlag(value, 10, 35, 8, 42);
}

// Lead-to-booked target: green 20–40%; yellow within 5pts (15–45%); red outside.
export function leadToBookedFlag(value: number | null): Flag {
  return bandFlag(value, 0.2, 0.4, 0.15, 0.45);
}

// Show rate target: green 50–70%; yellow within 5pts (45–75%); red outside.
export function showRateFlag(value: number | null): Flag {
  return bandFlag(value, 0.5, 0.7, 0.45, 0.75);
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
