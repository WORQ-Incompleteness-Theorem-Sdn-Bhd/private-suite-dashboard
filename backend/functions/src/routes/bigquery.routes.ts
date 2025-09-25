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
  reloadSheetsCache,
  getSheetsCacheStatus,
} from "../controller/bigquery.controller";
const router = Router();

router.get("/resources", getResources);
router.get("/locations", getLocations);
router.get("/floors", getFloors);
router.get("/availability", getAvailability);

// Admin endpoints for sheet cache management
router.get("/admin/reload-sheets-cache", reloadSheetsCache);
router.get("/admin/sheets-cache-status", getSheetsCacheStatus);

export default router;
