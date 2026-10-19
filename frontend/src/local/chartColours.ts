/**
 * Chart colours in Ameresco's palette, checked for colour-blind separation
 * (deutan, protan, tritan) and contrast on white. Blue and green are the
 * brand colours; the rest extend them for charts with more series.
 * Use categorical colours in this order, never cycled.
 */
export const CHART = {
  blue: '#0065a5',
  green: '#008540',
  orange: '#c2410c',
  /** "Before", measured or context marks. */
  grey: '#94a3b8',
  /** Closed hours and other background bands. */
  band: '#eef2f6',
  ink: '#334155',
  grid: '#f1f5f9',
  axis: '#64748b',
} as const;

/** Categorical order for up to seven series (validated as a set in this order). */
export const CATEGORICAL = ['#0065a5', '#008540', '#7c3aed', '#c2410c', '#0891b2', '#a16207', '#be185d'] as const;

/** Day types: working days, weekends, bank holidays. */
export const DAY_TYPE_COLOURS = { Weekday: CATEGORICAL[0], Weekend: CATEGORICAL[1], 'Bank holiday': CATEGORICAL[2] } as const;
