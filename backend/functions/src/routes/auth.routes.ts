//Routes for authentication
//Handles token verification and authentication
//Uses the handleToken function from the auth.controller.ts file
//Uses the Router from the express library
//Exports the router for use in the main application

import { Router } from "express";
import { handleToken } from "../controller/auth.controller";

const router = Router();

router.post("/", handleToken);

export default router;
