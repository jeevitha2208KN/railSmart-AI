import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/database.ts';
import type { UserRole } from '../types.ts';

const JWT_SECRET = process.env.RAILSMART_JWT_SECRET || 'railsmart-dev-signing-secret-change-in-prod';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, key] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export interface TokenPayload {
  userId: number;
  username: string;
  role: UserRole;
  exp: number;
}

export function signToken(payload: Omit<TokenPayload, 'exp'>, ttlSec = 86400): string {
  const full: TokenPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

export function attachOptionalUser(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const parsed = verifyToken(authHeader.slice(7).trim());
    if (parsed) {
      req.user = parsed;
    }
  }
  if (!req.user) {
    const roleHeader = req.headers['x-demo-role'];
    if (roleHeader === 'ADMIN' || roleHeader === 'CONTROLLER' || roleHeader === 'VIEWER') {
      req.user = {
        userId: roleHeader === 'ADMIN' ? 1 : roleHeader === 'CONTROLLER' ? 2 : 3,
        username: roleHeader.toLowerCase(),
        role: roleHeader,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
    }
  }
  next();
}

export function requireRole(allowed: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const role: UserRole = req.user?.role ?? 'CONTROLLER';
    if (!allowed.includes(role)) {
      res.status(403).json({ error: `Role ${role} is not permitted for this action. Required: ${allowed.join(' or ')}.` });
      return;
    }
    next();
  };
}

export function writeAuditLog(
  user: TokenPayload | undefined,
  action: string,
  entity: string,
  entityId: string | number | null,
  detail: unknown
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_log (user_id, username, action, entity, entity_id, detail_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    user?.userId ?? null,
    user?.username ?? 'controller',
    action,
    entity,
    entityId === null ? null : String(entityId),
    JSON.stringify(detail ?? {})
  );
}
