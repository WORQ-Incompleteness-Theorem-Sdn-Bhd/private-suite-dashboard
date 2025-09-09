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
