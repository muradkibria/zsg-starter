// Sign-in codes: six digits, one per person, unique across the team.
//
// A million possible codes is few enough to guess, so wrong guesses are rationed
// (SignInGate): a few per address, and a cap across everyone, after which sign-in
// pauses until the oldest wrong guess is an hour old. People already signed in
// aren't affected.

import { randomInt } from "node:crypto";

/** A random code, "000000" to "999999". */
export function randomCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export interface GateLimits {
  /** Wrong codes allowed from one address within `addressWindowMs` */
  perAddress: number;
  addressWindowMs: number;
  /** Wrong codes allowed from everyone together within `overallWindowMs` */
  overall: number;
  overallWindowMs: number;
}

export class SignInGate {
  private byAddress = new Map<string, number[]>();
  private all: number[] = [];

  constructor(private limits: GateLimits) {}

  /** Why this address can't try a code right now, or null when it can. */
  blocked(address: string, now = Date.now()): string | null {
    this.all = this.all.filter((t) => now - t < this.limits.overallWindowMs);
    if (this.all.length >= this.limits.overall) return "Sign-in is paused after too many wrong codes. Try again in an hour.";
    const mine = this.recent(address, now);
    if (mine.length >= this.limits.perAddress) {
      return `Too many wrong codes. Try again in ${Math.ceil(this.limits.addressWindowMs / 60_000)} minutes.`;
    }
    return null;
  }

  wrong(address: string, now = Date.now()): void {
    this.byAddress.set(address, [...this.recent(address, now), now]);
    this.all.push(now);
    // Forget addresses that have gone quiet, so the map can't grow without end.
    if (this.byAddress.size > 10_000) for (const a of [...this.byAddress.keys()]) this.recent(a, now);
  }

  right(address: string): void {
    this.byAddress.delete(address);
  }

  private recent(address: string, now: number): number[] {
    const list = (this.byAddress.get(address) ?? []).filter((t) => now - t < this.limits.addressWindowMs);
    if (list.length) this.byAddress.set(address, list);
    else this.byAddress.delete(address);
    return list;
  }
}
