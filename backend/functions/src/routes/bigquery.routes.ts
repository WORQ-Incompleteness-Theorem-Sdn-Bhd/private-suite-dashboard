//Routes for BigQuery
//Handles requests to BigQuery API
//Uses the getAvailability, getFloors, getLocations, and getResources functions from the bigquery.controller.ts file
//Uses the Router from the express library
//Exports the router for use in the main application
import { Router } from "express";
import {
  getAvailability,
  getFloors,
  getLocations,
  getResources,
} from "../controller/bigquery.controller";
const router = Router();

router.get("/resources", getResources);
router.get("/locations", getLocations);
router.get("/floors", getFloors);
router.get("/availability", getAvailability);

export default router;
