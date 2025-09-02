import { Router } from "express";
import { handleToken } from "../controller/auth.controller";

const router = Router();

router.post("/", handleToken);

export default router;
