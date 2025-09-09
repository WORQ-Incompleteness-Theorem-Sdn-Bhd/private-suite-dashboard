import express from "express";
import cors from "cors";
import bqRoutes from "./routes/bigquery.routes";
import authRoutes from "./routes/auth.routes";
import floorplanRoutes from "./routes/floorplan.routes";
import { requireAuth } from "./middleware/auth";

const app = express();

app.use(cors({ origin: true }));

app.use("/api/floorplans", requireAuth, floorplanRoutes);

app.use("/api/token", express.json({ limit: "10mb" }), authRoutes);
app.use("/api/bigquery", express.json({ limit: "10mb" }), requireAuth, bqRoutes);

export default app;
