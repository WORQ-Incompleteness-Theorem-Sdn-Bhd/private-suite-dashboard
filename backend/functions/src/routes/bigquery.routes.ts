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
