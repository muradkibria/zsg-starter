// Contracts for clients: advertisers who sign in to the client portal with their
// own six-digit code to see and download their campaigns' reports. The team sets
// them up (Clients in the hub); a client only ever sees the campaigns linked to it.

import type { CampaignStatus } from "./campaigns";

/** Who's signed in to the portal (GET /auth/me for a client). */
export interface ClientSession {
  kind: "client";
  id: string;
  name: string;
}

// ── Hub: managing clients ─────────────────────────────────────────────────────

export interface ClientCampaignRef {
  id: string;
  advertiser: string;
  name: string;
  startDay: string | null;
  endDay: string | null;
  /** Drafts aren't shown in the portal until confirmed */
  confirmed: boolean;
}

export interface ClientAccount {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string;
  disabled: boolean;
  /** Whether they have a sign-in code; without one they can't sign in */
  hasCode: boolean;
  /** ISO time of their last portal sign-in, if any */
  lastSignInAt: string | null;
  created: string;
  campaigns: ClientCampaignRef[];
}

/** POST /clients */
export interface ClientInput {
  name: string;
  contactName?: string;
  contactEmail?: string;
  campaignIds?: string[];
}

/** PATCH /clients/:id */
export interface ClientPatch {
  name?: string;
  contactName?: string;
  contactEmail?: string;
  disabled?: boolean;
  /** The campaigns their portal shows (replaces the list) */
  campaignIds?: string[];
}

/** POST /clients and POST /clients/:id/new-code. The code is shown once and never logged. */
export interface ClientCodeResult {
  client: ClientAccount;
  code: string;
}

// ── Portal ────────────────────────────────────────────────────────────────────

export interface PortalCampaign {
  id: string;
  advertiser: string;
  name: string;
  startDay: string | null;
  endDay: string | null;
  status: CampaignStatus;
  /** One of its ads with a thumbnail (GET /portal/ads/:id/thumb) */
  thumbId: string | null;
  /** Measured plays inside the campaign dates, up to now */
  plays: number;
  /** Measured seconds on screen inside the campaign dates */
  playSeconds: number;
  /** Bags that played it in the last 7 days */
  bagsCarrying: number;
  /** ISO hour of the most recent play we hold */
  lastPlayedAt: string | null;
}

/** GET /portal/overview */
export interface PortalOverview {
  client: ClientSession;
  /** Today in London */
  today: string;
  campaigns: PortalCampaign[];
}

/** A ready-made report period for the portal's report list. */
export interface PortalPeriod {
  key: string;
  label: string;
  fromDay: string;
  toDay: string;
  kind: "campaign" | "month" | "week";
}

/** GET /portal/campaigns/:id: the campaign to date. */
export interface PortalCampaignDetail {
  campaign: PortalCampaign;
  /** The campaign's dates so far (start → today or the end) */
  fromDay: string;
  toDay: string;
  totals: { plays: number; seconds: number; bags: number; daysWithPlays: number; km: number; impressions: number };
  perDay: { day: string; plays: number; seconds: number; bags: number; impressions: number }[];
  ads: { key: string; name: string; mediaType: "video" | "image" | null; thumbId: string | null; plays: number }[];
  periods: PortalPeriod[];
}
