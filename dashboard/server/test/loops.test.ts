import { beforeEach, describe, expect, it, vi } from "vitest";

// ── In-memory PocketBase and gated writes for the publish flow ────────────────
const h = vi.hoisted(() => ({
  tables: new Map<string, Record<string, unknown>[]>(),
  seq: 0,
  settings: { fleetWritesEnabled: false, fleetLoopName: "June 26" } as Record<string, unknown>,
  decision: { action: "send", reason: "Sent to the test bag." } as { action: string; reason: string; blocked?: number[] },
  accountWrites: true,
  calls: [] as unknown[][],
}));

vi.mock("../src/pb", () => {
  const table = (n: string) => {
    if (!h.tables.has(n)) h.tables.set(n, []);
    return h.tables.get(n)!;
  };
  const collection = (name: string) => ({
    create: async (data: Record<string, unknown>) => {
      const rec = { id: `r${++h.seq}`, created: "2026-09-29 19:00:00.000Z", updated: "2026-09-29 19:00:00.000Z", ...data, expand: {} };
      table(name).push(rec);
      return rec;
    },
    update: async (id: string, data: Record<string, unknown>) => {
      const t = table(name);
      const i = t.findIndex((r) => r.id === id);
      t[i] = { ...t[i], ...data };
      return t[i];
    },
    getList: async () => ({ items: [] }),
  });
  return {
    pb: { baseURL: "http://pb", files: { getToken: async () => "token" }, collection },
    getAll: async (name: string) => table(name).slice(),
    getFirst: async () => null,
    batchCreate: async (name: string, rows: Record<string, unknown>[]) => {
      for (const r of rows) table(name).push({ id: `r${++h.seq}`, ...r });
      return rows.length;
    },
    pbDate: (d: Date) => d.toISOString().replace("T", " "),
    parsePbDate: (s: string | null | undefined) => (s ? new Date(String(s).replace(" ", "T")) : null),
    q: (v: unknown) => JSON.stringify(v),
  };
});
vi.mock("../src/domain/bags", () => ({ loadBags: async () => h.tables.get("bags") ?? [], invalidateBags: () => {} }));
vi.mock("../src/domain/settings", () => ({
  getSettings: async () => h.settings,
  updateSettings: async (p: Record<string, unknown>) => Object.assign(h.settings, p),
}));
vi.mock("../src/domain/audit", () => ({ audit: async (...args: unknown[]) => void h.calls.push(["audit", ...args]) }));
vi.mock("../src/colorlight/writes", () => ({
  accountWritesAllowed: () => h.accountWrites,
  decideFor: async () => h.decision,
  uploadMedia: async (_file: Buffer, filename: string) => {
    h.calls.push(["upload", filename]);
    return h.accountWrites ? { dryRun: false, media: { id: 777, name: "F_UP_3", source_url: "https://cl/F_UP_3.png" } } : { dryRun: true };
  },
  createProgram: async (title: string, items: unknown[]) => {
    h.calls.push(["createProgram", title, items]);
    return h.accountWrites ? { dryRun: false, program: { id: 9001, name: title, vsn: null } } : { dryRun: true };
  },
  publishProgram: async (programId: number, groupId: number, ids: number[]) => {
    h.calls.push(["publishProgram", programId, groupId, ids]);
    return { decision: h.decision };
  },
}));
import {
  checkCreativeFile,
  creativeNameFromFile,
  creativeTypeOf,
  deliveryStateFor,
  diffLoopItems,
  isScreenShape,
  loopAgeLabel,
  loopCyclesPerHour,
  loopPlaysPerHour,
  loopSlotTimes,
  loopTotalSeconds,
  moveLoopItem,
  sameProgramName,
  type LoopDeliveryBagFacts,
  type LoopListItem,
} from "@digilite/shared";
import {
  colorlightFileName,
  fileKeyOf,
  groupCopies,
  imageSize,
  loopListOrder,
  normaliseItems,
  programItemFor,
  publishLoop,
  resolvePlayingLoop,
  sniffType,
} from "../src/domain/loops";
import type { RecordModel } from "../src/pb";

const rec = (o: Record<string, unknown>) => ({ collectionId: "x", collectionName: "x", ...o }) as unknown as RecordModel;

describe("loop maths", () => {
  const items = [{ seconds: 10 }, { seconds: 13 }, { seconds: 10 }, { seconds: 27 }];

  it("adds up the loop length and plays per hour", () => {
    expect(loopTotalSeconds(items)).toBe(60);
    expect(loopCyclesPerHour(items)).toBe(60);
    expect(loopCyclesPerHour([{ seconds: 43 }])).toBe(83);
  });

  it("is safe with an empty or broken loop", () => {
    expect(loopTotalSeconds([])).toBe(0);
    expect(loopCyclesPerHour([])).toBe(0);
    expect(loopTotalSeconds([{ seconds: Number.NaN }, { seconds: -5 }, { seconds: 10 }])).toBe(10);
  });

  it("gives each slot its start and end second", () => {
    expect(loopSlotTimes(items)).toEqual([
      [0, 10],
      [10, 23],
      [23, 33],
      [33, 60],
    ]);
  });

  it("counts a file listed twice as twice the plays", () => {
    const perHour = loopPlaysPerHour([
      { fileKey: "a", seconds: 10 },
      { fileKey: "b", seconds: 10 },
      { fileKey: "a", seconds: 10 },
    ]);
    expect(perHour.get("a")).toBe(240);
    expect(perHour.get("b")).toBe(120);
  });

  it("moves items without mutating the list", () => {
    const list = ["a", "b", "c", "d"];
    expect(moveLoopItem(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveLoopItem(list, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveLoopItem(list, 1, 99)).toEqual(["a", "c", "d", "b"]);
    expect(list).toEqual(["a", "b", "c", "d"]);
  });
});

describe("changes vs the fleet loop", () => {
  const it_ = (fileKey: string, seconds = 10) => ({ fileKey, seconds });

  it("lists added, removed and kept files", () => {
    const fleet = [it_("charity"), it_("mtf", 13), it_("fox1"), it_("fox4")];
    const draft = [it_("kungpao"), it_("charity"), it_("fox1"), it_("oriel")];
    const d = diffLoopItems(draft, fleet);
    expect(d.added.map((x) => x.fileKey)).toEqual(["kungpao", "oriel"]);
    expect(d.removed.map((x) => x.fileKey)).toEqual(["mtf", "fox4"]);
    expect(d.kept.map((x) => x.fileKey)).toEqual(["charity", "fox1"]);
    expect(d.orderChanged).toBe(false);
    expect(d.secondsBefore).toBe(43);
    expect(d.secondsAfter).toBe(40);
    expect(d.same).toBe(false);
  });

  it("treats identical copies of a file as the same ad", () => {
    const d = diffLoopItems([it_("F_A"), it_("F_B")], [it_("F_A"), it_("F_B")]);
    expect(d.same).toBe(true);
    expect(d.added).toEqual([]);
  });

  it("notices a new order of the same ads", () => {
    const d = diffLoopItems([it_("b"), it_("a")], [it_("a"), it_("b")]);
    expect(d.orderChanged).toBe(true);
    expect(d.same).toBe(false);
  });

  it("lists a repeated new file once", () => {
    const d = diffLoopItems([it_("x"), it_("x"), it_("a")], [it_("a")]);
    expect(d.added.map((x) => x.fileKey)).toEqual(["x"]);
  });
});

describe("delivery per bag", () => {
  const NOW = Date.parse("2026-09-29T19:00:00Z");
  const bag = (o: Partial<LoopDeliveryBagFacts>): LoopDeliveryBagFacts => ({
    status: "now",
    playing: null,
    downloadedProgramIds: [],
    downloadedProgramNames: [],
    lastReportAt: "2026-09-29T18:59:00Z",
    ...o,
  });
  const program = { id: 777, name: "Autumn loop" };

  it("is playing when the bag reports the loop", () => {
    expect(deliveryStateFor("sent", bag({ playing: "autumn loop" }), program, NOW).state).toBe("playing");
  });

  it("is downloaded when the bag has it but plays something else", () => {
    const d = deliveryStateFor("sent", bag({ playing: "June 26", downloadedProgramIds: [777] }), program, NOW);
    expect(d.state).toBe("downloaded");
  });

  it("waits for an offline bag, saying for how long", () => {
    const d = deliveryStateFor("sent", bag({ status: "gone", lastReportAt: "2026-07-31T12:00:00Z" }), program, NOW);
    expect(d.state).toBe("waiting_offline");
    expect(d.note).toBe("Offline for 60 days");
  });

  it("is sent when the bag is online but hasn't got it yet", () => {
    expect(deliveryStateFor("sent", bag({}), program, NOW).state).toBe("sent");
  });

  it("never claims delivery for a dry run or a blocked send", () => {
    expect(deliveryStateFor("dry_run", bag({ playing: "Autumn loop" }), program, NOW).state).toBe("dry_run");
    expect(deliveryStateFor("blocked", bag({}), program, NOW).state).toBe("blocked");
    expect(deliveryStateFor("failed", bag({}), program, NOW).state).toBe("failed");
  });

  it("matches downloads by name before the program id is known", () => {
    const d = deliveryStateFor("sent", bag({ downloadedProgramNames: ["Autumn loop"] }), { id: null, name: "Autumn loop" }, NOW);
    expect(d.state).toBe("downloaded");
  });

  it("compares program names loosely", () => {
    expect(sameProgramName(" June 26", "june 26")).toBe(true);
    expect(sameProgramName("", "")).toBe(false);
    expect(sameProgramName(null, "June 26")).toBe(false);
  });
});

describe("upload check", () => {
  const base = { filename: "kungpao_oct.mp4", mime: "video/mp4", sizeBytes: 18_000_000, width: 160, height: 120, durationS: 10 };

  it("passes a file made for the screen with no detail", () => {
    const c = checkCreativeFile(base);
    expect(c.ok).toBe(true);
    expect(c.problems).toEqual([]);
    expect(c.mediaType).toBe("video");
  });

  it("accepts a larger 4:3 file", () => {
    expect(checkCreativeFile({ ...base, width: 1512, height: 1134 }).ok).toBe(true);
    expect(isScreenShape(160, 122)).toBe(true);
    expect(isScreenShape(480, 480)).toBe(false);
  });

  it("flags the wrong shape, but lets it be added on purpose", () => {
    const c = checkCreativeFile({ ...base, width: 480, height: 480 });
    expect(c.ok).toBe(false);
    expect(c.problems.map((p) => p.kind)).toEqual(["wrong_shape"]);
    expect(c.problems[0].detail).toContain("square");
    expect(c.canAddAnyway).toBe(true);
  });

  it("flags a video that is too long", () => {
    const c = checkCreativeFile({ ...base, durationS: 75 });
    expect(c.problems.map((p) => p.kind)).toEqual(["too_long"]);
    expect(checkCreativeFile({ ...base, durationS: 60.3 }).ok).toBe(true);
  });

  it("refuses files that are too big or not supported", () => {
    const big = checkCreativeFile({ ...base, sizeBytes: 140 * 1024 * 1024 });
    expect(big.problems[0].kind).toBe("too_big");
    expect(big.canAddAnyway).toBe(false);
    const webm = checkCreativeFile({ ...base, filename: "ad.webm", mime: "video/webm" });
    expect(webm.problems[0].kind).toBe("unsupported");
    expect(webm.problems[0].detail).toContain(".webm");
  });

  it("works out types from the MIME type or the name", () => {
    expect(creativeTypeOf("", "AD.MOV")).toBe("video/quicktime");
    expect(creativeTypeOf("image/png", "x")).toBe("image/png");
    expect(creativeTypeOf("application/pdf", "brief.pdf")).toBeNull();
  });

  it("makes a readable name from the file name", () => {
    expect(creativeNameFromFile("kungpao_oct_v2.mp4")).toBe("kungpao oct v2");
    expect(creativeNameFromFile("Midas advert.MOV")).toBe("Midas advert");
  });
});

describe("loop age", () => {
  it("says how old a loop is in plain words", () => {
    expect(loopAgeLabel(null)).toBeNull();
    expect(loopAgeLabel(0)).toBe("Published today");
    expect(loopAgeLabel(1)).toBe("1 day old");
    expect(loopAgeLabel(20)).toBe("2 weeks old");
    expect(loopAgeLabel(112)).toBe("3 months old");
  });
});

describe("files", () => {
  it("names a file the way Colorlight does", () => {
    const key = colorlightFileName(Buffer.from("hello"));
    expect(key).toBe("F_5D41402ABC4B2A76B9719D911017C592_5");
  });

  it("uses the Colorlight file name as the key, or the record id before upload", () => {
    expect(fileKeyOf({ id: "abc", colorlight_md5: "F_X_1" })).toBe("F_X_1");
    expect(fileKeyOf({ id: "abc", colorlight_md5: "" })).toBe("id:abc");
  });

  it("recognises real files from their first bytes", () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(160, 16);
    png.writeUInt32BE(120, 20);
    expect(sniffType(png)).toBe("image/png");
    expect(imageSize(png, "image/png")).toEqual({ width: 160, height: 120 });

    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom0000")]);
    expect(sniffType(mp4)).toBe("video/mp4");
    const mov = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  0000")]);
    expect(sniffType(mov)).toBe("video/quicktime");
    expect(sniffType(Buffer.from("not a video at all"))).toBeNull();

    const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([160, 0, 120, 0]), Buffer.alloc(4)]);
    expect(sniffType(gif)).toBe("image/gif");
    expect(imageSize(gif, "image/gif")).toEqual({ width: 160, height: 120 });

    // JPEG: SOI, then an SOF0 segment holding height 120 and width 160
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x78, 0x00, 0xa0, 0x03, 0, 0, 0, 0]);
    expect(sniffType(jpg)).toBe("image/jpeg");
    expect(imageSize(jpg, "image/jpeg")).toEqual({ width: 160, height: 120 });
  });
});

describe("library and loops", () => {
  it("groups identical copies, oldest Colorlight copy first", () => {
    const groups = groupCopies([
      rec({ id: "c3", colorlight_md5: "F_A", colorlight_media_id: 300, created: "2026-01-03" }),
      rec({ id: "c1", colorlight_md5: "F_A", colorlight_media_id: 100, created: "2026-01-01", archived: true }),
      rec({ id: "c2", colorlight_md5: "F_A", colorlight_media_id: 200, created: "2026-01-02" }),
      rec({ id: "u1", colorlight_md5: "", colorlight_media_id: 0, created: "2026-01-04" }),
    ]);
    expect(groups.size).toBe(2);
    expect(groups.get("F_A")!.map((c) => c.id)).toEqual(["c2", "c3", "c1"]);
  });

  it("tells same-named loops apart by what the bag downloaded", () => {
    const loops = [
      rec({ id: "old", name: "MTF", status: "imported", colorlight_program_id: 4468296, colorlight_program_name: "MTF", published_at: "2025-05-27" }),
      rec({ id: "new", name: "MTF", status: "imported", colorlight_program_id: 6436469, colorlight_program_name: "MTF", published_at: "2026-05-09" }),
      rec({ id: "draft", name: "June 26", status: "draft", items: [] }),
    ];
    const bag = (downloaded: { id: number; name: string }[], playing = "MTF") =>
      rec({ id: "b", playing_program: playing, playing_vsn: "", downloaded_programs: downloaded });
    expect(resolvePlayingLoop(bag([{ id: 4468296, name: "MTF" }]), loops)?.id).toBe("old");
    expect(resolvePlayingLoop(bag([]), loops)?.id).toBe("new");
    // A draft never "plays": it isn't in Colorlight yet.
    expect(resolvePlayingLoop(bag([], "June 26"), loops)).toBeNull();
    // The raw VSN name is understood when the program name is missing.
    const vsnBag = rec({ id: "b", playing_program: "", playing_vsn: "MTF_83fca0e70b30cbf5090390aa11223344_7174.vsn", downloaded_programs: [] });
    expect(resolvePlayingLoop(vsnBag, loops)?.id).toBe("new");
  });

  it("plays videos for their own length and checks every ad exists", () => {
    const ctx = {
      creativeById: new Map([
        ["vid", rec({ id: "vid", name: "Video", media_type: "video", duration_s: 13 })],
        ["img", rec({ id: "img", name: "Poster", media_type: "image", duration_s: 10 })],
      ]),
    };
    const ok = normaliseItems(ctx, [
      { creative: "vid", seconds: 5 },
      { creative: "img", seconds: 7 },
    ]);
    expect(ok.error).toBeNull();
    expect(ok.items).toEqual([
      { creative: "vid", seconds: 13 },
      { creative: "img", seconds: 7 },
    ]);
    expect(normaliseItems(ctx, [{ creative: "gone", seconds: 10 }]).error).toContain("no longer in the library");
    expect(normaliseItems(ctx, [{ creative: "img", seconds: 0.2 }]).error).toContain("between 1 and 600");
  });

  it("builds the program item Colorlight expects", () => {
    const item = programItemFor(
      rec({
        id: "c",
        name: "Fox",
        media_type: "video",
        colorlight_media_id: 5971431,
        colorlight_md5: "F_01F8_219054",
        colorlight_url: "https://beu.colorlightcloud.com:443/wp-content/Tus/uploads/x/F_01F8_219054.MP4",
        width: 160,
        height: 120,
      }),
      10.4,
    );
    expect(item).toEqual({
      fileID: 5971431,
      filename: "F_01F8_219054.MP4",
      sourceUrl: "https://beu.colorlightcloud.com:443/wp-content/Tus/uploads/x/F_01F8_219054.MP4",
      fileType: "mp4",
      type: "video",
      durationSeconds: 10,
      width: 160,
      height: 120,
    });
  });

  it("orders loops: fleet loop, then loops on bags, then drafts, then the rest", () => {
    const loop = (o: Partial<LoopListItem>) =>
      ({ id: "x", name: "x", status: "imported", isFleetLoop: false, bagsPlaying: [], publishedAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", ...o }) as LoopListItem;
    const bags = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `Bag ${i}`, status: "now" as const, isTestBag: false, lastReportAt: null }));
    const list = [
      loop({ id: "old", publishedAt: "2025-01-01" }),
      loop({ id: "draft", status: "draft", updatedAt: "2026-09-01" }),
      loop({ id: "two", bagsPlaying: bags(2) }),
      loop({ id: "fleet", isFleetLoop: true, bagsPlaying: bags(38) }),
      loop({ id: "newer", publishedAt: "2026-05-01" }),
    ].sort(loopListOrder);
    expect(list.map((l) => l.id)).toEqual(["fleet", "two", "draft", "newer", "old"]);
  });
});

describe("sending a loop", () => {
  const TEST = 5786440;
  const USER = { id: "u1", email: "o@x", name: "Owner", role: "owner" as const };

  beforeEach(() => {
    h.tables.clear();
    h.calls.length = 0;
    h.settings.fleetLoopName = "June 26";
    h.settings.fleetWritesEnabled = false;
    h.decision = { action: "send", reason: "Sent to the test bag." };
    h.accountWrites = true;
    h.tables.set("bags", [
      { id: "b28", name: "Bag 028", colorlight_id: TEST, group_id: 7232, lifecycle: "active", last_report_at: "2026-07-30 13:22:27.000Z", downloaded_programs: [] },
      { id: "b06", name: "Bag 006", colorlight_id: 5257479, group_id: 7232, lifecycle: "active", last_report_at: "2026-09-29 18:59:00.000Z", playing_program: "June 26", downloaded_programs: [{ id: 6696773, name: "June 26" }] },
      { id: "b99", name: "Bag 099", colorlight_id: 1, group_id: 7232, lifecycle: "retired", last_report_at: "", downloaded_programs: [] },
    ]);
    h.tables.set("creatives", [
      { id: "c1", name: "Charity", media_type: "video", duration_s: 10, colorlight_media_id: 5818032, colorlight_md5: "F_A_1", colorlight_url: "https://cl/F_A_1.mp4", width: 160, height: 120, created: "2026-01-01" },
      { id: "c2", name: "Poster", media_type: "image", duration_s: 10, colorlight_media_id: 0, colorlight_md5: "F_UP_3", file: "poster.png", width: 160, height: 120, source: "uploaded", created: "2026-09-29" },
    ]);
    h.tables.set("loops", [
      { id: "fleet", name: "June 26", status: "imported", colorlight_program_id: 6696773, colorlight_program_name: "June 26", items: [{ creative: "c1", seconds: 10 }], published_at: "2026-06-09 11:52:53.000Z" },
      { id: "draft", name: "Autumn loop", status: "draft", items: [{ creative: "c1", seconds: 10 }], published_at: "" },
    ]);
  });

  const loop = (id: string) => h.tables.get("loops")!.find((l) => l.id === id)!;
  const calls = (kind: string) => h.calls.filter((c) => c[0] === kind);

  it("sends to the test bag: creates the program, publishes to that bag only, marks the draft published", async () => {
    const r = await publishLoop("draft", { target: "test" }, USER);
    expect(r.deployment.status).toBe("sent");
    expect(calls("createProgram")).toHaveLength(1);
    expect((calls("createProgram")[0][2] as { fileID: number }[])[0].fileID).toBe(5818032);
    expect(calls("publishProgram")).toEqual([["publishProgram", 9001, 7232, [TEST]]]);
    expect(loop("draft")).toMatchObject({ status: "published", colorlight_program_id: 9001 });
    const dep = h.tables.get("deployments")![0];
    expect(dep).toMatchObject({ target: "test_bag", status: "sent", colorlight_program_id: 9001 });
    expect(h.tables.get("commands")!.map((c) => [c.bag, c.type, c.status])).toEqual([["b28", "publish", "sent"]]);
    // The test bag is offline, so delivery waits for it.
    expect(r.deployment.delivery[0]).toMatchObject({ bagName: "Bag 028", state: "waiting_offline" });
    expect(calls("audit").some((a) => a[2] === "loop.publish" && String(a[3]).startsWith('Sent "Autumn loop" to the test bag'))).toBe(true);
  });

  it("asks the gate first: a blocked send uploads and creates nothing", async () => {
    h.decision = { action: "block", reason: "Only the test bag can be changed right now.", blocked: [5257479] };
    const r = await publishLoop("draft", { target: "bags", bagIds: ["b28", "b06"] }, USER);
    expect(r.deployment.status).toBe("blocked");
    expect(r.deployment.message).toContain("Only the test bag can be changed right now.");
    expect(r.deployment.message).toContain("Bag 006");
    expect(calls("createProgram")).toHaveLength(0);
    expect(calls("publishProgram")).toHaveLength(0);
    expect(loop("draft").status).toBe("draft");
    expect(h.tables.get("commands")!.every((c) => c.status === "blocked")).toBe(true);
    h.decision = { action: "send", reason: "Sent to the test bag." };
  });

  it("records a dry run when changes are switched off, and the draft stays a draft", async () => {
    h.decision = { action: "dry_run", reason: "Changes are switched off (dry run). Nothing was sent to the bag." };
    h.accountWrites = false;
    h.tables.get("loops")!.find((l) => l.id === "draft")!.items = [{ creative: "c2", seconds: 8 }];
    const r = await publishLoop("draft", { target: "test" }, USER);
    expect(r.deployment.status).toBe("dry_run");
    expect(r.deployment.steps.map((s) => [s.step, s.result])).toEqual([
      ["upload", "dry_run"],
      ["program", "dry_run"],
      ["publish", "dry_run"],
    ]);
    expect(r.deployment.delivery[0].state).toBe("dry_run");
    expect(loop("draft").status).toBe("draft");
    h.decision = { action: "send", reason: "Sent to the test bag." };
  });

  it("uploads a file that isn't in Colorlight yet and uses its new id in the program", async () => {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1, 2, 3])));
    h.tables.get("loops")!.find((l) => l.id === "draft")!.items = [{ creative: "c2", seconds: 8 }];
    const r = await publishLoop("draft", { target: "test" }, USER);
    vi.unstubAllGlobals();
    expect(r.deployment.status).toBe("sent");
    expect(calls("upload")).toEqual([["upload", "poster.png"]]);
    expect(h.tables.get("creatives")!.find((c) => c.id === "c2")).toMatchObject({ colorlight_media_id: 777, colorlight_url: "https://cl/F_UP_3.png" });
    expect((calls("createProgram")[0][2] as { fileID: number; durationSeconds: number }[])[0]).toMatchObject({ fileID: 777, durationSeconds: 8 });
  });

  it("sends an imported loop without re-creating it, and a fleet send leaves out retired bags", async () => {
    h.settings.fleetWritesEnabled = true;
    h.tables.get("loops")!.push({ id: "may", name: "May 26", status: "imported", colorlight_program_id: 6463136, colorlight_program_name: "May 26", items: [{ creative: "c1", seconds: 10 }], published_at: "2026-05-11 21:34:25.000Z" });
    const r = await publishLoop("may", { target: "fleet" }, USER);
    expect(r.deployment.status).toBe("sent");
    expect(calls("createProgram")).toHaveLength(0);
    expect(calls("publishProgram")).toEqual([["publishProgram", 6463136, 7232, [5257479, TEST]]]);
    expect(loop("may").status).toBe("imported");
    // Sending to every bag makes it the fleet loop.
    expect(h.settings.fleetLoopName).toBe("May 26");
    h.settings.fleetWritesEnabled = false;
  });

  it("refuses to send a new loop whose name is already used in Colorlight", async () => {
    loop("draft").name = "June 26";
    await expect(publishLoop("draft", { target: "test" }, USER)).rejects.toThrow(/already in Colorlight/);
    expect(h.tables.get("deployments") ?? []).toHaveLength(0);
  });
});
