import { Router } from "express";
import { listPosts, getPost, createPost, updatePost, deletePost } from "../controllers/postController";
import { authMiddleware } from "../middleware/auth";

const router = Router();

router.get("/", listPosts);
router.get("/:id", getPost);
router.post("/", authMiddleware, createPost);
router.patch("/:id", authMiddleware, updatePost);
router.delete("/:id", authMiddleware, deletePost);

export default router;
