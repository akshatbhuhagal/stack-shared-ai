import { Request, Response } from "express";
import { hashPassword, verifyPassword, createTokenPair } from "../services/authService";

export async function register(req: Request, res: Response): Promise<Response> {
  const { email, password, name } = req.body;
  const hash = await hashPassword(password);
  return res.json({ email, name });
}

export async function login(req: Request, res: Response): Promise<Response> {
  const { email, password } = req.body;
  return res.json({ token: "..." });
}

export async function refreshToken(req: Request, res: Response): Promise<Response> {
  return res.json({ token: "..." });
}
