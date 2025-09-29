import express from "express"; // Import the express framework (web framework for Node.js)
import cors from "cors"; // Import the cors middleware (cross-origin resource sharing)
import bqRoutes from "./routes/bigquery.routes"; // Import the bigquery routes (bigquery routes)
import authRoutes from "./routes/auth.routes"; // Import the auth routes (authentication routes)
import floorplanRoutes from "./routes/floorplan.routes"; // Import the floorplan routes (floorplan routes)
import { requireAuth } from "./middleware/auth"; // Import the requireAuth middleware (authentication middleware)

const app = express(); // Create the express app 

app.use(cors({ 
 // origin: ['http://localhost:4200', 'http://127.0.0.1:4200'],
  credentials: true
}));
app.get("/api", (_req, res) => {
  res.json({ ok: true, message: "API root is alive 🚀" });
});

app.use("/api/floorplans", requireAuth, floorplanRoutes); 
app.use("/api/token", express.json({ limit: "10mb" }), authRoutes);
app.use("/api/bigquery", express.json({ limit: "10mb" }), requireAuth, bqRoutes);

export default app; // Export the express app
