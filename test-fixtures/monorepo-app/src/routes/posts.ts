import { Router } from "express";
import { listPosts, getPost, createPost } from "../controllers/postController";

const router = Router();

router.get("/", listPosts);
router.get("/:id", getPost);
router.post("/", createPost);   // orphan: mobile doesn't call this

export default router;
