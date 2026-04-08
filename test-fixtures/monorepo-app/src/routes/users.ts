import { Router } from "express";
import { getUserProfile } from "../controllers/userController";

const router = Router();

// Entire resource is orphan — mobile never calls /api/users/*
router.get("/me", getUserProfile);

export default router;
