import { Router } from "express";
import {
  getAllFloorplans,
  getFloorplan,
  handleUpload,
} from "../controller/floorplan.controller";

const router = Router();

router.post("/", handleUpload);
router.get("/", getAllFloorplans);
router.get("/:officeId/:floorId?", getFloorplan);
// router.get("/:officeId/:floorId", getFloorplan);
// router.get("/:officeId", getFloorplan); 

export default router;
