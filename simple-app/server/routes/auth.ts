import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pb } from "../db/pocketbase.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;

  try {
    // Authenticate against PocketBase users collection
    const authData = await pb.collection("users").authWithPassword(email, password);
    const user = authData.record;

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user["role"] ?? "admin" },
      process.env.JWT_SECRET!,
      { expiresIn: "24h" }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user["name"] ?? user.email, role: user["role"] ?? "admin" },
    });
  } catch {
    res.status(401).json({ error: "Invalid credentials" });
  }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await pb.collection("users").getOne(req.user!.userId);
    res.json({ id: user.id, email: user.email, name: user["name"] ?? user.email, role: user["role"] ?? "admin" });
  } catch {
    res.status(404).json({ error: "User not found" });
  }
});

authRouter.post("/logout", (_req, res) => {
  res.json({ ok: true });
});
