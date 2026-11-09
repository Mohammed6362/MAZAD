import { authClient, userClient } from './supabase.js';

export async function requireAuth(req, res, next) {
  try {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!match) return res.status(401).json({ error: 'Authentication required' });
    const token = match[1];
    // Verify with Supabase Auth, not with untrusted decoded JWT content.
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user || data.user.is_anonymous) {
      return res.status(401).json({ error: 'Invalid or expired credentials' });
    }
    req.user = data.user;
    req.accessToken = token;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.accessToken) return res.status(401).json({ error: 'Authentication required' });
      const client = userClient(req.accessToken);
      const { data, error } = await client
        .from('user_roles')
        .select('role')
        .eq('user_id', req.user.id)
        .single();
      if (error || !data) return res.status(403).json({ error: 'Role not assigned' });
      if (!allowedRoles.includes(data.role)) return res.status(403).json({ error: 'Forbidden' });
      req.userRole = data.role;
      next();
    } catch (error) {
      next(error);
    }
  };
}
