// The fleet map's ads layer: beside each bag that's out now, a small screen
// showing its loop's ads in order, each for its slot's length. Bags report which
// loop they're playing, not which ad is on screen this second, so every bag on a
// loop shows the same ad at the same time. Hovering the ad, or the bag's marker,
// enlarges it.
//
// These are HTML markers (one per bag out now) so they can animate; the bags
// themselves stay a GPU layer.

import { Marker, type Map as MLMap } from "maplibre-gl";
import { loopSlotAt, type LiveBag, type OnScreenResponse, type OnScreenSlot } from "@digilite/shared";

interface Pin {
  marker: Marker;
  el: HTMLButtonElement;
  imgs: [HTMLImageElement, HTMLImageElement];
  loopId: string;
  bagName: string;
  shown: OnScreenSlot | null;
}

export class AdPins {
  private pins = new Map<string, Pin>();
  private onScreen: OnScreenResponse | null = null;
  private timer: number | null = null;
  private hovered: string | null = null;

  constructor(
    private map: MLMap,
    private onPick: (bagId: string) => void,
  ) {}

  /** Show the ads of `bags` that are out now with a loop we know; an empty list removes them all. */
  update(bags: LiveBag[], onScreen: OnScreenResponse | null | undefined) {
    this.onScreen = onScreen ?? null;
    const want = new Map<string, LiveBag>();
    for (const b of onScreen ? bags : []) {
      const loopId = onScreen!.bags[b.id];
      if (b.status === "now" && b.position && loopId && onScreen!.loops[loopId]?.slots.length) want.set(b.id, b);
    }
    for (const [id, pin] of this.pins) {
      if (!want.has(id)) {
        pin.marker.remove();
        this.pins.delete(id);
      }
    }
    for (const [id, b] of want) {
      const pin = this.pins.get(id) ?? this.create(id);
      this.pins.set(id, pin);
      pin.loopId = onScreen!.bags[id];
      pin.bagName = b.name;
      pin.marker.setLngLat([b.position!.lng, b.position!.lat]);
      // On, but no fresh GPS fix: faded like its marker.
      pin.el.classList.toggle("is-stale", !b.lastGpsAt || Date.now() - Date.parse(b.lastGpsAt) > 10 * 60_000);
    }
    this.tick(true);
    if (this.pins.size && this.timer === null) this.timer = window.setInterval(() => this.tick(), 1000);
    if (!this.pins.size && this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** The bag under the mouse on the map (null: none): its ad grows as if hovered. */
  hover(bagId: string | null) {
    if (bagId === this.hovered) return;
    if (this.hovered) this.pins.get(this.hovered)?.el.classList.remove("is-hover");
    this.hovered = bagId;
    if (bagId) this.pins.get(bagId)?.el.classList.add("is-hover");
  }

  destroy() {
    this.update([], null);
  }

  private create(bagId: string): Pin {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "ad-pin";
    const screen = document.createElement("span");
    screen.className = "ad-pin__screen";
    const imgs: [HTMLImageElement, HTMLImageElement] = [document.createElement("img"), document.createElement("img")];
    for (const img of imgs) {
      img.alt = "";
      img.decoding = "async";
      screen.append(img);
    }
    el.append(screen);
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onPick(bagId);
    });
    const marker = new Marker({ element: el, anchor: "right", offset: [-12, 0] }).setLngLat([0, 0]).addTo(this.map);
    return { marker, el, imgs, loopId: "", bagName: "", shown: null };
  }

  /** Move every pin on to its loop's current ad, fading from one to the next. */
  private tick(labels = false) {
    const now = Date.now() / 1000;
    for (const pin of this.pins.values()) {
      const loop = this.onScreen?.loops[pin.loopId];
      if (!loop) continue;
      const slot = loopSlotAt(loop, now);
      const changed = slot !== pin.shown;
      if (changed) {
        pin.shown = slot;
        const [front, back] = pin.imgs[0].classList.contains("is-on") ? pin.imgs : [pin.imgs[1], pin.imgs[0]];
        if (slot.thumbUrl) {
          back.onload = () => {
            back.classList.add("is-on");
            front.classList.remove("is-on");
          };
          back.onerror = () => front.classList.remove("is-on");
          back.src = slot.thumbUrl;
        } else {
          front.classList.remove("is-on");
        }
      }
      if (changed || labels) {
        const ad = slot.advertiser && slot.advertiser !== slot.name ? `${slot.name} (${slot.advertiser})` : slot.name;
        pin.el.title = `${pin.bagName} · ${ad}\nLoop "${loop.name}"`;
        pin.el.setAttribute("aria-label", `${pin.bagName}, showing ${ad}. Open this bag.`);
      }
    }
  }
}
