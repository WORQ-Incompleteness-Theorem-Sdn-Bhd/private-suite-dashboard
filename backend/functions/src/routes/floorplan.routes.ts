//Routes for floorplan
//Handles requests to floorplan API
//Uses the getAllFloorplans, getFloorplan, handleUpload, and deleteFloorplan functions from the floorplan.controller.ts file
//Uses the Router from the express library
//Exports the router for use in the main application
import { Router } from "express";
import {
  getAllFloorplans,
  getFloorplan,
  handleUpload,
  deleteFloorplan,
} from "../controller/floorplan.controller";

const router = Router();

router.post("/", handleUpload);
router.get("/", getAllFloorplans);
router.get("/:officeId", getFloorplan);
router.get("/:officeId/:floorId", getFloorplan);
// Delete routes - order matters! More specific routes must come first
router.delete("/:officeId/:floorId/:filename", deleteFloorplan); // Delete specific file in floor
router.delete("/:officeId/:floorId", deleteFloorplan);           // Delete all floor-level files
router.delete("/:officeId/:filename", deleteFloorplan);          // Delete specific office-level file
router.delete("/:officeId", deleteFloorplan);                    // Delete all office-level files

export default router;
