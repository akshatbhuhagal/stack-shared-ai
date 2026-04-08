import { Router } from "express";
import { getAllUsers, getUserById, updateUser, deleteUser } from "../controllers/userController";
import { authMiddleware } from "../middleware/auth";
import { adminOnly } from "../middleware/admin";

const router = Router();

router.get("/", authMiddleware, adminOnly, getAllUsers);
router.get("/:id", authMiddleware, getUserById);
router.patch("/:id", authMiddleware, updateUser);
router.delete("/:id", authMiddleware, adminOnly, deleteUser);

export default router;
