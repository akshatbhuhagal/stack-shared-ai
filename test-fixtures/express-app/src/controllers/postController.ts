import { Request, Response } from "express";

export async function listPosts(req: Request, res: Response) {
  return res.json([]);
}

export async function getPost(req: Request, res: Response) {
  return res.json({ id: req.params.id });
}

export async function createPost(req: Request, res: Response) {
  return res.status(201).json({});
}

export async function updatePost(req: Request, res: Response) {
  return res.json({});
}

export async function deletePost(req: Request, res: Response) {
  return res.status(204).send();
}
