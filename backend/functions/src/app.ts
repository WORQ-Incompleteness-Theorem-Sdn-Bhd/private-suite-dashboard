import express from "express"; // Import the express framework (web framework for Node.js)
import cors from "cors"; // Import the cors middleware (cross-origin resource sharing)
import bqRoutes from "./routes/bigquery.routes"; // Import the bigquery routes (bigquery routes)
import authRoutes from "./routes/auth.routes"; // Import the auth routes (authentication routes)
import floorplanRoutes from "./routes/floorplan.routes"; // Import the floorplan routes (floorplan routes)
import { requireAuth } from "./middleware/auth"; // Import the requireAuth middleware (authentication middleware)

const app = express(); // Create the express app 

app.use(cors({ origin: true })); // Use the cors middleware to allow requests from all origins

app.use("/api/floorplans", requireAuth, floorplanRoutes); // Use the requireAuth middleware to authenticate requests to the floorplan routes

app.use("/api/token", express.json({ limit: "10mb" }), authRoutes); // Use the express.json middleware to parse the request body
app.use("/api/bigquery", express.json({ limit: "10mb" }), requireAuth, bqRoutes); // Use the requireAuth middleware to authenticate requests to the bigquery routes

export default app; // Export the express app
