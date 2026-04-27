// Realistic mock data centred on London

export const MOCK_USERS = [
  {
    id: "usr_admin1",
    email: "admin@digilite.com",
    password: "DigiLite$2025",
    role: "admin",
    name: "Admin User",
    created: "2025-01-01T00:00:00Z",
  },
];

export const MOCK_RIDERS = [
  {
    id: "rdr_1", name: "James Okafor", phone: "+44 7700 900111", email: "james.okafor@email.com",
    address: "14 Brixton Road, London SW9 7AA", status: "active", bag_id: "bag_1",
    documents: [
      { type: "National ID", filename: "james_id.pdf", url: "https://placehold.co/600x400/eee/333?text=National+ID" },
      { type: "Proof of Address", filename: "james_poa.pdf", url: "https://placehold.co/600x400/eee/333?text=Proof+of+Address" },
    ],
    created: "2025-02-10T09:00:00Z",
  },
  {
    id: "rdr_2", name: "Priya Sharma", phone: "+44 7700 900222", email: "priya.sharma@email.com",
    address: "7 Whitechapel High St, London E1 7PX", status: "active", bag_id: "bag_2",
    documents: [
      { type: "National ID", filename: "priya_id.pdf", url: "https://placehold.co/600x400/eee/333?text=National+ID" },
      { type: "Proof of Address", filename: "priya_poa.pdf", url: "https://placehold.co/600x400/eee/333?text=Proof+of+Address" },
      { type: "DBS Check", filename: "priya_dbs.pdf", url: "https://placehold.co/600x400/eee/333?text=DBS+Check" },
    ],
    created: "2025-02-12T10:00:00Z",
  },
  {
    id: "rdr_3", name: "Carlos Mendez", phone: "+44 7700 900333", email: "carlos.mendez@email.com",
    address: "22 Shoreditch High St, London E1 6PX", status: "active", bag_id: "bag_3",
    documents: [
      { type: "National ID", filename: "carlos_id.pdf", url: "https://placehold.co/600x400/eee/333?text=National+ID" },
    ],
    created: "2025-03-01T08:30:00Z",
  },
  {
    id: "rdr_4", name: "Amara Diallo", phone: "+44 7700 900444", email: "amara.diallo@email.com",
    address: "55 Peckham Road, London SE5 8UH", status: "inactive", bag_id: null,
    documents: [
      { type: "National ID", filename: "amara_id.pdf", url: "https://placehold.co/600x400/eee/333?text=National+ID" },
      { type: "Proof of Address", filename: "amara_poa.pdf", url: "https://placehold.co/600x400/eee/333?text=Proof+of+Address" },
    ],
    created: "2025-03-15T11:00:00Z",
  },
  {
    id: "rdr_5", name: "Tom Fletcher", phone: "+44 7700 900555", email: "tom.fletcher@email.com",
    address: "9 Camden High St, London NW1 7JE", status: "active", bag_id: "bag_4",
    documents: [
      { type: "National ID", filename: "tom_id.pdf", url: "https://placehold.co/600x400/eee/333?text=National+ID" },
      { type: "DBS Check", filename: "tom_dbs.pdf", url: "https://placehold.co/600x400/eee/333?text=DBS+Check" },
    ],
    created: "2025-04-01T09:15:00Z",
  },
];

export const MOCK_BAGS = [
  {
    id: "bag_1",
    name: "BAG-001",
    colorlight_device_id: "CL-DEV-001",
    rider_id: "rdr_1",
    status: "active",
    last_lat: 51.5074,
    last_lng: -0.1278,
    last_speed: 12.4,
    last_heading: 90,
    last_gps_at: new Date(Date.now() - 5000).toISOString(),
    created: "2025-02-10T09:00:00Z",
    expand: { rider_id: { id: "rdr_1", name: "James Okafor" } },
  },
  {
    id: "bag_2",
    name: "BAG-002",
    colorlight_device_id: "CL-DEV-002",
    rider_id: "rdr_2",
    status: "active",
    last_lat: 51.5155,
    last_lng: -0.0922,
    last_speed: 8.1,
    last_heading: 180,
    last_gps_at: new Date(Date.now() - 8000).toISOString(),
    created: "2025-02-12T10:00:00Z",
    expand: { rider_id: { id: "rdr_2", name: "Priya Sharma" } },
  },
  {
    id: "bag_3",
    name: "BAG-003",
    colorlight_device_id: "CL-DEV-003",
    rider_id: "rdr_3",
    status: "active",
    last_lat: 51.4994,
    last_lng: -0.1245,
    last_speed: 15.7,
    last_heading: 270,
    last_gps_at: new Date(Date.now() - 3000).toISOString(),
    created: "2025-03-01T08:30:00Z",
    expand: { rider_id: { id: "rdr_3", name: "Carlos Mendez" } },
  },
  {
    id: "bag_4",
    name: "BAG-004",
    colorlight_device_id: "CL-DEV-004",
    rider_id: "rdr_5",
    status: "active",
    last_lat: 51.5220,
    last_lng: -0.1550,
    last_speed: 6.3,
    last_heading: 45,
    last_gps_at: new Date(Date.now() - 12000).toISOString(),
    created: "2025-04-01T09:15:00Z",
    expand: { rider_id: { id: "rdr_5", name: "Tom Fletcher" } },
  },
  {
    id: "bag_5",
    name: "BAG-005",
    colorlight_device_id: "CL-DEV-005",
    rider_id: "rdr_4",
    status: "inactive",
    last_lat: 51.5033,
    last_lng: -0.0886,
    last_speed: 0,
    last_heading: 0,
    last_gps_at: new Date(Date.now() - 3600000).toISOString(),
    created: "2025-03-15T11:00:00Z",
    expand: { rider_id: { id: "rdr_4", name: "Amara Diallo" } },
  },
];

export const MOCK_CAMPAIGNS = [
  {
    id: "cmp_1",
    name: "Summer Sale 2025",
    client_name: "SportsDirect",
    status: "active",
    start_date: "2025-06-01",
    end_date: "2025-08-31",
    created_by: "usr_admin1",
    created: "2025-05-20T09:00:00Z",
  },
  {
    id: "cmp_2",
    name: "City Commuter Campaign",
    client_name: "TFL",
    status: "active",
    start_date: "2025-04-01",
    end_date: "2025-12-31",
    created_by: "usr_admin1",
    created: "2025-03-25T10:00:00Z",
  },
  {
    id: "cmp_3",
    name: "New Menu Launch",
    client_name: "Burger King UK",
    status: "draft",
    start_date: "2025-05-01",
    end_date: "2025-05-31",
    created_by: "usr_admin1",
    created: "2025-04-10T11:00:00Z",
  },
  {
    id: "cmp_4",
    name: "Holiday Deals",
    client_name: "Thomas Cook",
    status: "ended",
    start_date: "2025-01-01",
    end_date: "2025-03-31",
    created_by: "usr_admin1",
    created: "2024-12-15T08:00:00Z",
  },
];

export const MOCK_MEDIA = [
  {
    id: "med_1",
    campaign_id: "cmp_1",
    filename: "summer-sale-banner.mp4",
    file_type: "video",
    duration_seconds: 15,
    file_size_bytes: 4200000,
    fileUrl: "https://placehold.co/1920x1080/ff6b35/white?text=Summer+Sale",
    created: "2025-05-21T09:30:00Z",
  },
  {
    id: "med_2",
    campaign_id: "cmp_1",
    filename: "summer-sale-static.jpg",
    file_type: "image",
    duration_seconds: 8,
    file_size_bytes: 890000,
    fileUrl: "https://placehold.co/1920x1080/ff6b35/white?text=Summer+Banner",
    created: "2025-05-21T10:00:00Z",
  },
  {
    id: "med_3",
    campaign_id: "cmp_2",
    filename: "tfl-commuter.mp4",
    file_type: "video",
    duration_seconds: 20,
    file_size_bytes: 6800000,
    fileUrl: "https://placehold.co/1920x1080/003b6f/white?text=TFL+Commuter",
    created: "2025-03-26T09:00:00Z",
  },
  {
    id: "med_4",
    campaign_id: "cmp_3",
    filename: "bk-new-menu.jpg",
    file_type: "image",
    duration_seconds: 10,
    file_size_bytes: 1200000,
    fileUrl: "https://placehold.co/1920x1080/d62300/white?text=BK+New+Menu",
    created: "2025-04-11T09:00:00Z",
  },
];

export const MOCK_SCHEDULES = [
  {
    id: "sch_1",
    bag_id: "bag_1",
    media_id: "med_3",
    start_date: "2025-04-01",
    end_date: "2025-12-31",
    start_time: "07:00",
    end_time: "09:00",
    days_of_week: [1, 2, 3, 4, 5],
    priority: 1,
    created: "2025-03-28T09:00:00Z",
    expand: { bag_id: MOCK_BAGS[0], media_id: MOCK_MEDIA[2] },
  },
  {
    id: "sch_2",
    bag_id: "bag_2",
    media_id: "med_1",
    start_date: "2025-06-01",
    end_date: "2025-08-31",
    start_time: "10:00",
    end_time: "18:00",
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    priority: 2,
    created: "2025-05-22T09:00:00Z",
    expand: { bag_id: MOCK_BAGS[1], media_id: MOCK_MEDIA[0] },
  },
  {
    id: "sch_3",
    bag_id: "bag_3",
    media_id: "med_2",
    start_date: "2025-06-01",
    end_date: "2025-08-31",
    start_time: "08:00",
    end_time: "20:00",
    days_of_week: [1, 2, 3, 4, 5],
    priority: 1,
    created: "2025-05-22T10:00:00Z",
    expand: { bag_id: MOCK_BAGS[2], media_id: MOCK_MEDIA[1] },
  },
];

export const MOCK_ZONES = [
  {
    id: "zone_1",
    name: "Central London",
    type: "radius",
    center_lat: 51.5074,
    center_lng: -0.1278,
    radius_meters: 2000,
    polygon_geojson: null,
    active: true,
    created: "2025-02-01T09:00:00Z",
  },
  {
    id: "zone_2",
    name: "Canary Wharf",
    type: "radius",
    center_lat: 51.5054,
    center_lng: -0.0235,
    radius_meters: 800,
    polygon_geojson: null,
    active: true,
    created: "2025-02-01T09:30:00Z",
  },
  {
    id: "zone_3",
    name: "Shoreditch Triangle",
    type: "polygon",
    center_lat: null,
    center_lng: null,
    radius_meters: null,
    polygon_geojson: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-0.0769, 51.5246],
          [-0.0697, 51.5246],
          [-0.0697, 51.5190],
          [-0.0769, 51.5190],
          [-0.0769, 51.5246],
        ]],
      },
    },
    active: true,
    created: "2025-03-05T10:00:00Z",
  },
];

// Generate GPS history for a bag (last 24h, 3s intervals = ~28,800 points; we return 500 for mock)
export function generateGpsHistory(bagId: string, baseLat: number, baseLng: number) {
  const points = [];
  const now = Date.now();
  for (let i = 500; i >= 0; i--) {
    const t = new Date(now - i * 30_000); // one point per 30s
    points.push({
      id: `gps_${bagId}_${i}`,
      bag_id: bagId,
      lat: baseLat + (Math.random() - 0.5) * 0.02,
      lng: baseLng + (Math.random() - 0.5) * 0.03,
      speed: Math.random() * 25,
      heading: Math.floor(Math.random() * 360),
      created: t.toISOString(),
    });
  }
  return points;
}

export const MOCK_AUDIT = Array.from({ length: 50 }, (_, i) => ({
  id: `aud_${i + 1}`,
  user_id: "usr_admin1",
  action: ["login", "create_campaign", "upload_media", "assign_schedule", "create_zone"][i % 5],
  entity_type: ["user", "campaign", "media_asset", "schedule", "zone"][i % 5],
  entity_id: `entity_${i + 1}`,
  details: {},
  created: new Date(Date.now() - i * 3_600_000).toISOString(),
  expand: {
    user_id: { id: "usr_admin1", email: "admin@digilite.com" },
  },
}));

export const MOCK_ZONE_DWELLS = [
  {
    id: "dwell_1",
    bag_id: "bag_1",
    zone_id: "zone_1",
    entered_at: new Date(Date.now() - 3600000).toISOString(),
    exited_at: new Date(Date.now() - 1800000).toISOString(),
    dwell_seconds: 1800,
    created: new Date(Date.now() - 3600000).toISOString(),
    expand: { bag_id: MOCK_BAGS[0], zone_id: MOCK_ZONES[0] },
  },
  {
    id: "dwell_2",
    bag_id: "bag_2",
    zone_id: "zone_1",
    entered_at: new Date(Date.now() - 7200000).toISOString(),
    exited_at: new Date(Date.now() - 5400000).toISOString(),
    dwell_seconds: 1800,
    created: new Date(Date.now() - 7200000).toISOString(),
    expand: { bag_id: MOCK_BAGS[1], zone_id: MOCK_ZONES[0] },
  },
];

export const MOCK_AD_PLAY_EVENTS = Array.from({ length: 200 }, (_, i) => ({
  id: `play_${i + 1}`,
  bag_id: MOCK_BAGS[i % 4].id,
  media_id: MOCK_MEDIA[i % 4].id,
  played_at: new Date(Date.now() - i * 600_000).toISOString(),
  duration_seconds: [15, 8, 20, 10][i % 4],
  created: new Date(Date.now() - i * 600_000).toISOString(),
}));

// Brightness schedules — applied to all bags unless bag_id is set
export const MOCK_BRIGHTNESS_SCHEDULES = [
  {
    id: "brt_1",
    name: "Morning",
    start_time: "06:00",
    end_time: "09:59",
    brightness_percent: 60,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    bag_id: null,
    enabled: true,
    created: "2025-03-01T09:00:00Z",
  },
  {
    id: "brt_2",
    name: "Daytime",
    start_time: "10:00",
    end_time: "17:59",
    brightness_percent: 100,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    bag_id: null,
    enabled: true,
    created: "2025-03-01T09:00:00Z",
  },
  {
    id: "brt_3",
    name: "Evening",
    start_time: "18:00",
    end_time: "21:59",
    brightness_percent: 70,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    bag_id: null,
    enabled: true,
    created: "2025-03-01T09:00:00Z",
  },
  {
    id: "brt_4",
    name: "Night",
    start_time: "22:00",
    end_time: "05:59",
    brightness_percent: 40,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    bag_id: null,
    enabled: true,
    created: "2025-03-01T09:00:00Z",
  },
];

// Rider online sessions — multiple per day reflecting shift → break → shift patterns
function makeSession(id: string, riderId: string, bagId: string, daysAgo: number, startHour: number, durationHours: number) {
  const base = new Date();
  base.setDate(base.getDate() - daysAgo);
  base.setHours(startHour, 0, 0, 0);
  const started = new Date(base);
  const ended = new Date(base.getTime() + durationHours * 3_600_000);
  return {
    id,
    rider_id: riderId,
    bag_id: bagId,
    started_at: started.toISOString(),
    ended_at: ended.toISOString(),
    duration_seconds: Math.round(durationHours * 3600),
  };
}

export const MOCK_RIDER_SESSIONS = [
  // James Okafor — morning shift, lunch break, afternoon shift, each day for 5 days
  makeSession("ses_1",  "rdr_1", "bag_1", 0,  8, 3.5),   // today morning
  makeSession("ses_2",  "rdr_1", "bag_1", 0, 13, 4),     // today afternoon
  makeSession("ses_3",  "rdr_1", "bag_1", 1,  8, 4),     // yesterday morning
  makeSession("ses_4",  "rdr_1", "bag_1", 1, 13, 3.5),   // yesterday afternoon
  makeSession("ses_5",  "rdr_1", "bag_1", 2,  7, 5),     // 2 days ago — single long shift
  makeSession("ses_6",  "rdr_1", "bag_1", 3,  8, 3),
  makeSession("ses_7",  "rdr_1", "bag_1", 3, 12, 1),     // short midday
  makeSession("ses_8",  "rdr_1", "bag_1", 3, 14, 4),
  makeSession("ses_9",  "rdr_1", "bag_1", 4,  9, 6),

  // Priya Sharma — two shifts per day
  makeSession("ses_10", "rdr_2", "bag_2", 0,  7, 4),
  makeSession("ses_11", "rdr_2", "bag_2", 0, 13, 3.5),
  makeSession("ses_12", "rdr_2", "bag_2", 1,  8, 3),
  makeSession("ses_13", "rdr_2", "bag_2", 1, 14, 4),
  makeSession("ses_14", "rdr_2", "bag_2", 2,  7, 4.5),
  makeSession("ses_15", "rdr_2", "bag_2", 2, 13, 2),
  makeSession("ses_16", "rdr_2", "bag_2", 3,  8, 5),
  makeSession("ses_17", "rdr_2", "bag_2", 4,  9, 3.5),
  makeSession("ses_18", "rdr_2", "bag_2", 4, 14, 3),

  // Carlos Mendez
  makeSession("ses_19", "rdr_3", "bag_3", 0,  6, 4),
  makeSession("ses_20", "rdr_3", "bag_3", 0, 12, 2),
  makeSession("ses_21", "rdr_3", "bag_3", 0, 16, 3),
  makeSession("ses_22", "rdr_3", "bag_3", 1,  7, 5),
  makeSession("ses_23", "rdr_3", "bag_3", 1, 14, 2.5),
  makeSession("ses_24", "rdr_3", "bag_3", 2,  8, 4),
  makeSession("ses_25", "rdr_3", "bag_3", 3,  9, 3),
  makeSession("ses_26", "rdr_3", "bag_3", 3, 13, 4),

  // Tom Fletcher
  makeSession("ses_27", "rdr_5", "bag_4", 0,  9, 3),
  makeSession("ses_28", "rdr_5", "bag_4", 0, 14, 3.5),
  makeSession("ses_29", "rdr_5", "bag_4", 1,  8, 4),
  makeSession("ses_30", "rdr_5", "bag_4", 1, 14, 3),
  makeSession("ses_31", "rdr_5", "bag_4", 2,  9, 2.5),
  makeSession("ses_32", "rdr_5", "bag_4", 2, 13, 2),
  makeSession("ses_33", "rdr_5", "bag_4", 3, 10, 5),
];

// Ad slots — each bag has 6 slots in its 1-minute loop
// slot_number 1-6; media_id null = empty slot
export const MOCK_AD_SLOTS: { id: string; bag_id: string; slot_number: number; media_id: string | null; campaign_id: string | null }[] = [
  // bag_1
  { id: "asl_1_1", bag_id: "bag_1", slot_number: 1, media_id: "med_3", campaign_id: "cmp_2" },
  { id: "asl_1_2", bag_id: "bag_1", slot_number: 2, media_id: "med_1", campaign_id: "cmp_1" },
  { id: "asl_1_3", bag_id: "bag_1", slot_number: 3, media_id: null,    campaign_id: null },
  { id: "asl_1_4", bag_id: "bag_1", slot_number: 4, media_id: "med_3", campaign_id: "cmp_2" },
  { id: "asl_1_5", bag_id: "bag_1", slot_number: 5, media_id: null,    campaign_id: null },
  { id: "asl_1_6", bag_id: "bag_1", slot_number: 6, media_id: null,    campaign_id: null },
  // bag_2
  { id: "asl_2_1", bag_id: "bag_2", slot_number: 1, media_id: "med_1", campaign_id: "cmp_1" },
  { id: "asl_2_2", bag_id: "bag_2", slot_number: 2, media_id: "med_2", campaign_id: "cmp_1" },
  { id: "asl_2_3", bag_id: "bag_2", slot_number: 3, media_id: "med_4", campaign_id: "cmp_3" },
  { id: "asl_2_4", bag_id: "bag_2", slot_number: 4, media_id: "med_1", campaign_id: "cmp_1" },
  { id: "asl_2_5", bag_id: "bag_2", slot_number: 5, media_id: null,    campaign_id: null },
  { id: "asl_2_6", bag_id: "bag_2", slot_number: 6, media_id: null,    campaign_id: null },
  // bag_3
  { id: "asl_3_1", bag_id: "bag_3", slot_number: 1, media_id: "med_2", campaign_id: "cmp_1" },
  { id: "asl_3_2", bag_id: "bag_3", slot_number: 2, media_id: "med_3", campaign_id: "cmp_2" },
  { id: "asl_3_3", bag_id: "bag_3", slot_number: 3, media_id: null,    campaign_id: null },
  { id: "asl_3_4", bag_id: "bag_3", slot_number: 4, media_id: null,    campaign_id: null },
  { id: "asl_3_5", bag_id: "bag_3", slot_number: 5, media_id: null,    campaign_id: null },
  { id: "asl_3_6", bag_id: "bag_3", slot_number: 6, media_id: null,    campaign_id: null },
  // bag_4
  { id: "asl_4_1", bag_id: "bag_4", slot_number: 1, media_id: "med_1", campaign_id: "cmp_1" },
  { id: "asl_4_2", bag_id: "bag_4", slot_number: 2, media_id: null,    campaign_id: null },
  { id: "asl_4_3", bag_id: "bag_4", slot_number: 3, media_id: null,    campaign_id: null },
  { id: "asl_4_4", bag_id: "bag_4", slot_number: 4, media_id: null,    campaign_id: null },
  { id: "asl_4_5", bag_id: "bag_4", slot_number: 5, media_id: null,    campaign_id: null },
  { id: "asl_4_6", bag_id: "bag_4", slot_number: 6, media_id: null,    campaign_id: null },
  // bag_5 (inactive)
  { id: "asl_5_1", bag_id: "bag_5", slot_number: 1, media_id: null, campaign_id: null },
  { id: "asl_5_2", bag_id: "bag_5", slot_number: 2, media_id: null, campaign_id: null },
  { id: "asl_5_3", bag_id: "bag_5", slot_number: 3, media_id: null, campaign_id: null },
  { id: "asl_5_4", bag_id: "bag_5", slot_number: 4, media_id: null, campaign_id: null },
  { id: "asl_5_5", bag_id: "bag_5", slot_number: 5, media_id: null, campaign_id: null },
  { id: "asl_5_6", bag_id: "bag_5", slot_number: 6, media_id: null, campaign_id: null },
];
