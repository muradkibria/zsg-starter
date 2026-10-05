// Map marker icons drawn on canvas (GPU-rendered symbols, not DOM markers —
// so the map stays fast with hundreds or thousands of bags).

import type { Map as MLMap } from "maplibre-gl";
import { STATUS_COLOR } from "@digilite/shared";

const R = 2; // pixel ratio

function draw(size: number, fn: (c: CanvasRenderingContext2D, s: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size * R;
  const c = canvas.getContext("2d")!;
  c.scale(R, R);
  fn(c, size);
  return c.getImageData(0, 0, size * R, size * R);
}

function circle(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke?: string, lw = 0, alpha = 1) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.globalAlpha = alpha;
  c.fillStyle = fill;
  c.fill();
  c.globalAlpha = 1;
  if (stroke && lw) {
    c.lineWidth = lw;
    c.strokeStyle = stroke;
    c.stroke();
  }
}

export function addMapIcons(map: MLMap) {
  const add = (id: string, img: ImageData) => {
    if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: R });
  };
  add("st-now", draw(34, (c, s) => {
    circle(c, s / 2, s / 2, 15, STATUS_COLOR.now, undefined, 0, 0.18);
    circle(c, s / 2, s / 2, 7.5, STATUS_COLOR.now, "#ffffff", 2.6);
  }));
  add("st-day", draw(20, (c, s) => circle(c, s / 2, s / 2, 6.5, STATUS_COLOR.day, "#ffffff", 2.2)));
  add("st-idle", draw(20, (c, s) => circle(c, s / 2, s / 2, 6, "#ffffff", STATUS_COLOR.idle, 3)));
  add("st-gone", draw(20, (c, s) => {
    c.beginPath();
    c.roundRect(s / 2 - 6.5, s / 2 - 6.5, 13, 13, 2.5);
    c.fillStyle = STATUS_COLOR.gone;
    c.fill();
    c.lineWidth = 2.2;
    c.strokeStyle = "#ffffff";
    c.stroke();
  }));
  add("selected", draw(44, (c, s) => {
    circle(c, s / 2, s / 2, 20, "#061b47", undefined, 0, 0.14);
    circle(c, s / 2, s / 2, 9.5, "#061b47", "#ffffff", 3.2);
  }));
  // Replaying, during a signal gap: the last fix before it, greyed.
  add("replay-lost", draw(44, (c, s) => {
    circle(c, s / 2, s / 2, 20, "#8e8778", undefined, 0, 0.16);
    circle(c, s / 2, s / 2, 9.5, "#8e8778", "#ffffff", 3.2);
  }));
  add("start", draw(20, (c, s) => circle(c, s / 2, s / 2, 6, "#ffffff", "#061b47", 3.2)));
  add("stop", draw(34, (c, s) => {
    circle(c, s / 2, s / 2, 13, "#b7791f", undefined, 0, 0.2);
    c.beginPath();
    c.arc(s / 2, s / 2, 13, 0, Math.PI * 2);
    c.lineWidth = 2.6;
    c.strokeStyle = "#b7791f";
    c.stroke();
  }));
}
