import { Request, Response } from "express";
export async function listPosts(req: Request, res: Response) { return res.json([]); }
export async function getPost(req: Request, res: Response) { return res.json({}); }
export async function createPost(req: Request, res: Response) { return res.json({}); }
