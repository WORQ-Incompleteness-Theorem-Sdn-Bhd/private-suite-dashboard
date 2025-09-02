import dotenv from "dotenv";
dotenv.config();

import * as admin from "firebase-admin";
import app from "./app";
import { onRequest } from "firebase-functions/https";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.F1REBASE_PROJECT_ID,
      clientEmail: process.env.F1REBASE_CLIENT_EMAIL,
      privateKey: process.env.F1REBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export const appFunction = onRequest({ region: "asia-southeast1" }, app);
