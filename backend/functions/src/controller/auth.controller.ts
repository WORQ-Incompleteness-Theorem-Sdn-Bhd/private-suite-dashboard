import { Request, Response } from "express";
import admin from "firebase-admin";
import { generateToken } from "../middleware/auth";

export async function handleToken(req: Request, res: Response): Promise<void> {
  try {
    const uid = req.body.uid || "test-user";

    try {
      await admin.auth().getUser(uid);
    } catch {
      await admin.auth().createUser({ uid, email: `${uid}@worq.space` });
    }

    const token = await generateToken(uid);

    res.json({
      uid,
      token,
    });
  } catch (err: any) {
    console.log(err);
    res.status(500).json({ error: err.message || "Failed to generate token" });
  }
}
