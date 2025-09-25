import dotenv from "dotenv";
dotenv.config(); // Load environment variables from .env file

import * as admin from "firebase-admin"; // Initialize Firebase Admin SDK
import app from "./app"; // Import the Express app
import { onRequest } from "firebase-functions/https"; // Import the Firebase Functions HTTPS trigger

if (!admin.apps.length) { // Initialize Firebase Admin SDK if not already initialized
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.F1REBASE_PROJECT_ID, // Project ID from environment variables
      clientEmail: process.env.F1REBASE_CLIENT_EMAIL, // Client email from environment variables
      privateKey: process.env.F1REBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"), // Private key from environment variables
    }),
  });
}

export const appFunction = onRequest({ region: "asia-southeast1" }, app); // Export the Firebase Functions HTTPS trigger
