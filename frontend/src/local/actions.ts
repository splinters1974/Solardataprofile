/**
 * What has been done about each finding: status, owner, target date and
 * notes. Kept per site against the finding's key, so it survives the
 * findings being recalculated after a settings change, and saved in project
 * files. Customer editions carry the status only, unless owners and notes
 * are deliberately included.
 */
import type { Finding, Level, Confidence } from './findings';

export type ActionStatus = 'new' | 'review' | 'visit' | 'confirmed' | 'agreed' | 'implemented' | 'closed';

export const STATUS_LABEL: Record<ActionStatus, string> = {
  new: 'New',
  review: 'Under review',
  visit: 'Site visit required',
  confirmed: 'Confirmed',
  agreed: 'Action agreed',
  implemented: 'Implemented',
  closed: 'Closed',
};
export const STATUS_ORDER: ActionStatus[] = ['new', 'review', 'visit', 'confirmed', 'agreed', 'implemented', 'closed'];

export interface Action {
  status: ActionStatus;
  owner: string;
  targetDate: string;
  notes: string;
  updated: string;
}

export const newAction = (): Action => ({ status: 'new', owner: '', targetDate: '', notes: '', updated: '' });

export type ActionStore = Record<string, Action>;

/** A finding as an estate-wide opportunity record. */
export interface Opportunity {
  siteId: string;
  siteName: string;
  meterId: string;
  finding: Finding;
  action: Action;
}

export const LEVEL_RANK: Record<Level, number> = { high: 0, medium: 1, low: 2, info: 3 };
export const CONF_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

export type OppSort = 'impact' | 'confidence' | 'cost' | 'status' | 'site';

export function sortOpportunities(list: Opportunity[], by: OppSort): Opportunity[] {
  const cost = (o: Opportunity) => o.finding.cost?.annual ?? o.finding.cost?.observed ?? -1;
  return [...list].sort((a, b) => {
    switch (by) {
      case 'impact': return LEVEL_RANK[a.finding.level] - LEVEL_RANK[b.finding.level] || cost(b) - cost(a);
      case 'confidence': return CONF_RANK[a.finding.confidence] - CONF_RANK[b.finding.confidence] || LEVEL_RANK[a.finding.level] - LEVEL_RANK[b.finding.level];
      case 'cost': return cost(b) - cost(a);
      case 'status': return STATUS_ORDER.indexOf(a.action.status) - STATUS_ORDER.indexOf(b.action.status) || LEVEL_RANK[a.finding.level] - LEVEL_RANK[b.finding.level];
      default: return a.siteName.localeCompare(b.siteName, 'en-GB') || LEVEL_RANK[a.finding.level] - LEVEL_RANK[b.finding.level];
    }
  });
}

/** For customer editions: keep the status, drop owner and notes unless asked. */
export function sanitiseActions(store: ActionStore, includeInternal: boolean): ActionStore {
  if (includeInternal) return store;
  return Object.fromEntries(Object.entries(store).map(([k, a]) => [k, { ...a, owner: '', notes: '' }]));
}
