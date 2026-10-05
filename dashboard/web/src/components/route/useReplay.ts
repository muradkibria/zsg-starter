// Replaying a route: a moment on the day's timeline, played forward at a chosen
// speed or dragged by hand. `at` is null when the whole route is shown.
//
// Playback runs every animation frame. The map is drawn straight from each frame
// (useReplayOnMap), not through React, so it stays smooth; the page itself (the
// timeline's playhead and clock) updates about 30 times a second.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { buildReplayTrack, type ReplayTrack, type RouteResponse } from "@digilite/shared";
import { drawReplay } from "../map/layers";

/** Seconds of the day per second of playback: 1, 5 and 20 minutes a second. */
export const REPLAY_SPEEDS = [60, 300, 1200] as const;

type Listener = (at: number | null, playing: boolean) => void;

/** Pixels of the map covered by panels, on each side. */
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Replay {
  /** The moment shown (epoch ms), or null when the whole route is shown (for the page: ~30 updates a second) */
  at: number | null;
  playing: boolean;
  speed: number;
  /** First and last fix (epoch ms), or null when there's nothing to replay */
  span: [number, number] | null;
  track: ReplayTrack | null;
  /** Called every animation frame while playing, and on every seek */
  subscribe: (fn: Listener) => () => void;
  /** The moment shown right now (between page updates) */
  now: () => number | null;
  seek: (at: number) => void;
  play: () => void;
  pause: () => void;
  /** Back to the whole route */
  stop: () => void;
  nextSpeed: () => void;
}

export function useReplay(route: RouteResponse | null | undefined): Replay {
  const track = useMemo(() => (route?.times ? buildReplayTrack(route) : null), [route]);
  const span = track?.span ?? null;
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(REPLAY_SPEEDS[1]);
  const atRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const listeners = useRef(new Set<Listener>());
  const lastPageUpdate = useRef(0);

  const show = useCallback((v: number | null, page: boolean) => {
    atRef.current = v;
    for (const fn of listeners.current) fn(v, playingRef.current);
    if (page) {
      lastPageUpdate.current = performance.now();
      setAt(v);
    }
  }, []);
  const setRunning = (on: boolean) => {
    playingRef.current = on;
    setPlaying(on);
  };

  // Another bag or day starts with the whole route again.
  const key = route ? `${route.bagId}:${route.from}:${route.to}` : "";
  useEffect(() => {
    setRunning(false);
    show(null, true);
  }, [key, show]);

  useEffect(() => {
    if (!playing || !span) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // A long pause between frames (a hidden tab) doesn't jump ahead.
      const next = Math.min(span[1], (atRef.current ?? span[0]) + Math.min(now - last, 100) * speed);
      last = now;
      const done = next >= span[1];
      if (done) playingRef.current = false;
      show(next, done || now - lastPageUpdate.current >= 33);
      if (done) return setPlaying(false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, span, speed, show]);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);
  const now = useCallback(() => atRef.current, []);
  const clamp = (v: number) => (span ? Math.min(span[1], Math.max(span[0], v)) : v);

  return {
    at,
    playing,
    speed,
    span,
    track,
    subscribe,
    now,
    seek: (v) => span && show(clamp(v), true),
    play: () => {
      if (!span) return;
      if (atRef.current === null || atRef.current >= span[1]) show(span[0], true);
      setRunning(true);
    },
    pause: () => {
      setRunning(false);
      setAt(atRef.current);
    },
    stop: () => {
      setRunning(false);
      show(null, true);
    },
    nextSpeed: () => setSpeed((s) => REPLAY_SPEEDS[(REPLAY_SPEEDS.indexOf(s as (typeof REPLAY_SPEEDS)[number]) + 1) % REPLAY_SPEEDS.length]),
  };
}

/**
 * Draw `replay` on `map` every frame. With `follow`, the camera drifts after the bag
 * while it plays, keeping it within the middle of the visible area (`follow` gives
 * the edges covered by panels); it leaves the camera alone for a few seconds after
 * someone moves the map themselves.
 */
export function useReplayOnMap(map: MLMap | null, replay: Replay | undefined, follow?: () => Insets) {
  const followRef = useRef(follow);
  followRef.current = follow;
  const track = replay?.track ?? null;
  const subscribe = replay?.subscribe;
  const now = replay?.now;
  useEffect(() => {
    if (!map || !subscribe || !now) return;
    let movedByHand = 0;
    const onMove = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) movedByHand = performance.now();
    };
    map.on("movestart", onMove);
    const draw = (at: number | null, playing: boolean) => {
      const head = drawReplay(map, track, at);
      const pad = followRef.current?.();
      if (head && playing && pad && performance.now() - movedByHand > 4000) drift(map, head, pad);
    };
    draw(now(), false);
    const off = subscribe(draw);
    return () => {
      off();
      map.off("movestart", onMove);
    };
  }, [map, track, subscribe, now]);
}

/** Nudge the camera a little each frame towards keeping `head` in the middle 60% of the visible area. */
function drift(map: MLMap, head: [number, number], pad: Insets) {
  const el = map.getContainer();
  const w = el.clientWidth - pad.left - pad.right;
  const h = el.clientHeight - pad.top - pad.bottom;
  const p = map.project(head);
  const box = { l: pad.left + w * 0.2, r: pad.left + w * 0.8, t: pad.top + h * 0.2, b: pad.top + h * 0.8 };
  const dx = p.x < box.l ? p.x - box.l : p.x > box.r ? p.x - box.r : 0;
  const dy = p.y < box.t ? p.y - box.t : p.y > box.b ? p.y - box.b : 0;
  if (dx || dy) map.panBy([dx * 0.1, dy * 0.1], { duration: 0 });
}
