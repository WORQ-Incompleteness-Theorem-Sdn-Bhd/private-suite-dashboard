import express from "express";
import cors from "cors";
import bqRoutes from "./routes/resources.routes";
import authRoutes from "./routes/auth.routes";
import { requireAuth } from "./middleware/auth";
const app = express();
app.use(cors({ origin: true }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api/token", authRoutes);
app.use("/api/bq", requireAuth, bqRoutes);
export default app;
