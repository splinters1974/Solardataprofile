/**
 * Which version of the analyser this is. The Standard version is the
 * earlier, simpler tool; this build is the Advanced version. The name
 * appears in the header, the customer gate, file names and every PDF footer.
 */
export const PRODUCT = 'Data Analyser';
/**
 * Built twice from one codebase: `npm run build:standalone` makes Advanced,
 * `npm run build:standard` makes Standard (same engine and charts, fewer tabs).
 */
export const IS_STANDARD = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_VARIANT === 'standard';
export const VARIANT = IS_STANDARD ? 'Standard' : 'Advanced';
export const PRODUCT_FULL = `${PRODUCT} ${VARIANT}`;

/**
 * Set once a customer has changed anything in their edition (hours, rates,
 * capacity, scenarios, exclusions). Reports made after that say so, so a PDF
 * carrying Ameresco's name never passes off the customer's assumptions as ours.
 */
let customerEdits: string | null = null;
export const markCustomerEdits = (customer: string) => { customerEdits = customer; };
export const clearCustomerEdits = () => { customerEdits = null; };
export const customerEditsBy = () => customerEdits;

/** Footer text for every PDF page. */
export function pdfFooter(...parts: string[]): string {
  const note = customerEdits ? [`includes changes made by ${customerEdits}`] : [];
  return [`Ameresco ${PRODUCT_FULL}`, ...parts, ...note].join('  ·  ');
}
