import { Router } from "express";
import { getResources } from "../controller/resources.controller";
const router = Router();

router.get("/", getResources);
export default router;
