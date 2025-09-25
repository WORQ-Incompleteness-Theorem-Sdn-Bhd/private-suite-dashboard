//Routes for floorplan
//Handles requests to floorplan API
//Uses the getAllFloorplans, getFloorplan, and handleUpload functions from the floorplan.controller.ts file
//Uses the Router from the express library
//Exports the router for use in the main application
import { Router } from "express";
import {
  getAllFloorplans,
  getFloorplan,
  handleUpload,
} from "../controller/floorplan.controller";

const router = Router();

router.post("/", handleUpload);
router.get("/", getAllFloorplans);
router.get("/:officeId", getFloorplan);
router.get("/:officeId/:floorId", getFloorplan);

export default router;
