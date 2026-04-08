import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createTokenPair(userId: string): { accessToken: string; refreshToken: string } {
  const secret = process.env.JWT_SECRET!;
  const accessToken = jwt.sign({ userId }, secret, { expiresIn: "15m" });
  const refreshToken = jwt.sign({ userId }, secret, { expiresIn: "7d" });
  return { accessToken, refreshToken };
}
