// Shapes returned by Colorlight Cloud (only the fields we use).
// Docs: https://developer.colorlightcloud.com/cloudServer/en/

export interface ClTerminal {
  id: number;
  title?: { rendered?: string; raw?: string };
  terminalgroup?: { id: number; name: string }[] | number[];
  post_meta?: {
    _led_latest_report_time?: string | number;
    _led_latest_screenshot_time?: string | number;
    _led_status?: ClLedStatus;
    download_status?: { download_status_time?: number; programs?: { name: string; id: number; files?: unknown[] }[] };
    [k: string]: unknown;
  };
  extra?: { author_display_name?: string };
}

export interface ClLedStatus {
  info?: {
    _report_time?: number;
    info?: {
      model?: string;
      vername?: string;
      serialno?: string;
      playing?: { name?: string; source?: string; path?: string };
      storage?: { total?: number; free?: number };
      mem?: { total?: number; free?: number };
    };
  };
  brightnessandcolortemp?: { brightness?: number; colortemperature?: number; _report_time?: number };
  powerstatus?: { powerstatus?: number };
  WebSocketStatus?: { status?: string };
  dimension?: { width?: number; height?: number; real_width?: number; real_height?: number };
  rtc?: { timezone?: string; time?: string };
  newrtc?: { timezone?: number; timezoneId?: string };
  locale?: { country?: string; language?: string };
  reporttime?: { gps_report_interval?: number };
  "4ginfo"?: { data?: { networktype?: string; datastate?: string; simstate?: string; [k: string]: unknown } };
  [k: string]: unknown;
}

export interface ClLatestGps {
  terminalId: number;
  terminalName?: string;
  serverTime: string;
  clientTime?: string;
  reportTime?: string;
  latitude: number;
  longitude: number;
  speed?: number | null;
  direct?: number | null;
  accuracy?: number | null;
  satellites?: number | null;
}

export interface ClTrackPoint {
  latitude: number;
  longitude: number;
  serverTime: string;
  clientTime?: string;
}

export interface ClTrack {
  terminalId: number;
  data: ClTrackPoint[];
}

export interface ClPlayTimes {
  terminalId: number;
  totalPlayTimes: number;
  statistic: { mediaMd5: string; mediaName: string; mediaType: string; totalPlayTimes: number; totalPlayDuration: number }[];
}

export interface ClMedia {
  id: number;
  name?: string;
  title?: { rendered?: string; raw?: string };
  title_raw?: string;
  source_url?: string;
  video_thumbnail_jpg?: string;
  file_type?: string;
  mime_type?: string;
  date_gmt?: string;
  media_details?: { width?: number; height?: number; filesize?: number; playtime_seconds?: number };
}

export interface ClProgram {
  id: number;
  title?: { rendered?: string; raw?: string };
  title_raw?: string;
  vsn_name?: string;
  date_gmt?: string;
  modified_gmt?: string;
  [k: string]: unknown;
}
