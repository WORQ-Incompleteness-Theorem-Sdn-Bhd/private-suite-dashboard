// bq-client.ts
import { BigQuery } from "@google-cloud/bigquery";

export const bq = new BigQuery({
  projectId: process.env.F1REBASE_PROJECT_ID,
  credentials: {
    client_email: process.env.F1REBASE_CLIENT_EMAIL ?? 'firebase-adminsdk-fbsvc@floorplan-dashboard-2a468.iam.gserviceaccount.com',
    private_key: process.env.F1REBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
});
