import { Router } from "express";
import {signup,login, logout } from "../controllers/auth.controllers.js";
const router = Router();

router.post("/login", login);
router.post("/signup",signup);
router.post("/logout",logout);

export default router;