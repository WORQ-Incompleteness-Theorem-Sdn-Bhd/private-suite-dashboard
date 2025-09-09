import { Router } from "express";
import {
  getFloors,
  getLocations,
  getResources,
} from "../controller/bigquery.controller";
const router = Router();

router.get("/resources", getResources);
router.get("/locations", getLocations);
router.get("/floors", getFloors);
export default router;
