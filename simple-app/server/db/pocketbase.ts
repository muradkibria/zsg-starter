import PocketBase from "pocketbase";

export const pb = new PocketBase(process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090");

// Disable auto-cancellation so background services can make concurrent requests
pb.autoCancellation(false);

export async function authenticatePB() {
  const email = process.env.POCKETBASE_ADMIN_EMAIL ?? "admin@digilite.com";
  const password = process.env.POCKETBASE_ADMIN_PASSWORD ?? "";
  try {
    // PocketBase >= 0.23: use _superusers; earlier versions use admins
    await (pb as any).admins.authWithPassword(email, password);
    console.log("[pocketbase] authenticated as admin");
  } catch {
    try {
      await pb.collection("_superusers").authWithPassword(email, password);
      console.log("[pocketbase] authenticated as superuser");
    } catch (err: any) {
      console.warn("[pocketbase] admin auth failed:", err.message);
    }
  }
}

// Re-authenticate every 30 minutes to keep the token fresh
setInterval(() => {
  authenticatePB().catch(() => {});
}, 30 * 60 * 1000);
