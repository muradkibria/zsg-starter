import axios, { AxiosInstance } from "axios";

export interface ColortlightDevice {
  id: string;
  name: string;
  status: string;
  online: boolean;
}

export interface ColortlightGPS {
  deviceId: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  timestamp: string;
}

export class ColortlightError extends Error {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "ColortlightError";
  }
}

class ColortlightService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: process.env.COLORLIGHT_API_BASE ?? "https://api.colorlightinside.com",
      headers: {
        Authorization: `Bearer ${process.env.COLORLIGHT_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    this.client.interceptors.response.use(
      (res) => res,
      (err) => {
        const msg = err.response?.data?.message ?? err.message;
        throw new ColortlightError(msg, err.response?.status);
      }
    );
  }

  async getDeviceList(): Promise<ColortlightDevice[]> {
    const { data } = await this.client.get("/devices");
    return data.devices ?? data ?? [];
  }

  async getDeviceStatus(deviceId: string) {
    const { data } = await this.client.get(`/devices/${deviceId}/status`);
    return data;
  }

  async getDeviceGPS(deviceId: string): Promise<ColortlightGPS> {
    const { data } = await this.client.get(`/devices/${deviceId}/gps`);
    return data;
  }

  async uploadMedia(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    const form = new globalThis.FormData();
    const blob = new Blob([buffer], { type: mimeType });
    form.append("file", blob, filename);

    const { data } = await this.client.post("/media", form);
    return data.mediaId ?? data.id;
  }

  async createProgram(name: string, mediaId: string): Promise<string> {
    const { data } = await this.client.post("/programs", { name, mediaId });
    return data.programId ?? data.id;
  }

  async createPlaylist(name: string, programIds: string[]): Promise<string> {
    const { data } = await this.client.post("/playlists", { name, programIds });
    return data.playlistId ?? data.id;
  }

  async assignProgramToDevice(deviceId: string, programId: string) {
    await this.client.put(`/devices/${deviceId}/program`, { programId });
  }

  async restartDevice(deviceId: string) {
    await this.client.post(`/devices/${deviceId}/restart`);
  }

  async publishDevice(deviceId: string) {
    await this.client.post(`/devices/${deviceId}/publish`);
  }
}

export const colortlightService = new ColortlightService();
