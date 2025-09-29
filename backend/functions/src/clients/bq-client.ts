// bq-client.ts
import { BigQuery } from "@google-cloud/bigquery";

export const bq = new BigQuery({
  projectId: process.env.FIREBASE_PROJECT_ID,
  credentials: {
    client_email: process.env.FIREBASE_CLIENT_EMAIL ?? 'firebase-adminsdk-fbsvc@floorplan-dashboard-2a468.iam.gserviceaccount.com',
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
});
