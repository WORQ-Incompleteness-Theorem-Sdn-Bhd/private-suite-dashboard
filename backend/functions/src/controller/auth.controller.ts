import { Request, Response } from "express";
import admin from "firebase-admin";
import { generateToken } from "../middleware/auth";

export async function handleToken(req: Request, res: Response): Promise<void> {
  try {
    const { uid } = req.body; 

    if (!uid) {
      res.status(400).json({ error: "UID is required" });
      return;
    }


    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firebase authentication timeout after 10s')), 10000)
    );

    try {
      // Verify user exists in Firebase
      await Promise.race([
        admin.auth().getUser(uid),
        timeoutPromise
      ]);

    } catch (error: any) {

      if (error.code === 'auth/user-not-found') {
        res.status(404).json({ error: 'User not found' });
      } else {
        res.status(500).json({ error: 'Firebase authentication failed: ' + error.message });
      }
      return;
    }

    // Generate JWT token
    const token = generateToken(uid);

    res.json({
      uid,
      token,
      message: "Token generated successfully"
    });

  } catch (err: any) {

    res.status(500).json({ error: err.message || "Failed to generate token" });
  }
}