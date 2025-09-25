
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export const generateToken = (uid: string): string => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
  }
  return jwt.sign({ uid }, process.env.JWT_SECRET, {
    expiresIn: "3h",
  });
};

export const verifyToken = (token: string): { uid: string } => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET) as {
      uid: string;
    };

    return decoded;
  } catch (err) {
    throw new Error("Invalid or expired token");
  }
};

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decodedToken = verifyToken(token);

    (req as any).user = decodedToken;

    next();
  } catch (error) {
    console.error("Token verification failed", error);
    res.status(403).json({ error: "Forbidden: Invalid or expired token" });
  }
}
