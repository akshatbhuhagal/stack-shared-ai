import { Router } from "express";
import { login, register, refreshToken } from "../controllers/authController";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refreshToken);   // orphan: mobile doesn't call this

export default router;
