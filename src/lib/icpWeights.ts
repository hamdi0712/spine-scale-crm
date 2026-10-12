// The new scoring model's weights — every number it scores with, in one file.
//
// This is the file to edit to re-weight the model. Nothing else in the app
// states a point value: src/lib/icpScoring.ts reads every criterion's maximum,
// the fit floor and the tier bands from here, and the scorecard, the
// comparison report and the queue all read them from there. The totals below
// are derived from the parts, so changing one weight cannot leave a stale
// "out of 60" anywhere.
//
// What re-weighting does and does not do: a candidate already scored keeps the
// breakdown it was given (it is the transcript of a run), and a lead's tier
// is read off its stored points. Change a weight, and re-run Compare scoring
// to see what it would move before applying it.

// ─── Fit — is this the kind of clinic we serve? ────────────────────────────

export const FIT_WEIGHTS = {
  // A core service (non-surgical spine care, decompression, disc treatment, a
  // back-pain program…) with a cited quote earns all of this.
  serviceCore: 35,
  // An adjacent service — chiropractic, PT, pain management — earns this, and
  // only with a cited spine, disc or back-pain program as well. Without one it
  // earns nothing: a general sports chiro or general PT clinic is not a fit.
  serviceAdjacentWithSpineProgram: 25,
  // A target title, cited: on the contact record, or a named person on the site.
  title: 10,
  // Located in one of the ICP's target locations, cited.
  location: 10,
  // Location count inside the ICP's size band, AND positive evidence of a team
  // (more than one provider or support staff). An unclear single provider is
  // not a disqualifier — it simply does not earn these.
  size: 5,
} as const;

export const FIT_MAX =
  FIT_WEIGHTS.serviceCore + FIT_WEIGHTS.title + FIT_WEIGHTS.location + FIT_WEIGHTS.size;

// Below this, a clinic cannot be promoted whatever its total — it is rejected
// as "Not a confirmed fit" with what was missing. Signals only rank fits
// against each other; they never make a fit out of a clinic that is not one.
export const FIT_FLOOR = 40;

// ─── Signals — among fits, which first? ────────────────────────────────────

export const SIGNAL_WEIGHTS = {
  // Each of the ICP's buying triggers found with a citation, up to the cap.
  buyingTriggerEach: 10,
  buyingTriggersMax: 20,
  // The existing Budget Signal computation (budgetSignalScore in
  // src/lib/discovery.ts), read onto this scale: ads running now, or failing
  // that a healthy review count.
  budgetActiveAds: 10,
  budgetHealthyReviews: 5,
  // The existing three automation gaps, each found with the existing keyword
  // pre-check confirmed by the model. They sum to the gaps maximum.
  gapBooking: 4,
  gapReviews: 3,
  gapRemarketing: 3,
} as const;

export const BUDGET_MAX = SIGNAL_WEIGHTS.budgetActiveAds;
export const GAPS_MAX =
  SIGNAL_WEIGHTS.gapBooking + SIGNAL_WEIGHTS.gapReviews + SIGNAL_WEIGHTS.gapRemarketing;
export const SIGNALS_MAX = SIGNAL_WEIGHTS.buyingTriggersMax + BUDGET_MAX + GAPS_MAX;

export const V2_MAX_SCORE = FIT_MAX + SIGNALS_MAX;

// ─── The verdict ───────────────────────────────────────────────────────────

// The promotion bar's default, out of V2_MAX_SCORE. The live value is a
// setting (Settings → Pipeline), stored in its own column.
export const DEFAULT_V2_PROMOTION_THRESHOLD = 60;

// A 80+ · B 60–79 · C below 60.
export const V2_TIER_A_MIN = 80;
export const V2_TIER_B_MIN = 60;

// What the second-look sweep counts as a near miss on this scale: within this
// many points under the bar, or this many under the fit floor.
export const V2_NEAR_MISS_MARGIN = 10;
export const V2_FIT_FLOOR_NEAR_MISS = 5;
