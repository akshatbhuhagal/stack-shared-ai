import { Request, Response } from "express";

export async function getAllUsers(req: Request, res: Response) {
  return res.json([]);
}

export async function getUserById(req: Request, res: Response) {
  return res.json({ id: req.params.id });
}

export async function updateUser(req: Request, res: Response) {
  return res.json({ id: req.params.id });
}

export async function deleteUser(req: Request, res: Response) {
  return res.status(204).send();
}
