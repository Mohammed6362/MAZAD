import { Router } from 'express';
import { requireAuth, requireRole } from './guards.js';
import { authClient, userClient } from './supabase.js';

export const mazadAuthRouter = Router();

mazadAuthRouter.post('/signup', async (req, res, next) => {
  try {
    const { email, password, full_name } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Valid email and password (8–128 characters) required' });
    }
    const { data, error } = await authClient.auth.signUp({
      email, password,
      options: { data: { full_name: typeof full_name === 'string' ? full_name.slice(0, 200) : '' } },
    });
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ user: data.user, emailConfirmationRequired: !data.session });
  } catch (error) { next(error); }
});

mazadAuthRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Email and password required' });
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid credentials or email unconfirmed' });
    res.json({ session: data.session, user: data.user });
  } catch (error) { next(error); }
});

mazadAuthRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const client = userClient(req.accessToken);
    const [profile, roles] = await Promise.all([
      client.from('profiles').select('id,full_name,phone,avatar_url').eq('id', req.user.id).single(),
      client.from('user_roles').select('role').eq('user_id', req.user.id).single(),
    ]);
    if (profile.error || roles.error) return res.status(403).json({ error: 'Profile or role inaccessible' });
    res.json({ user: { id: req.user.id, email: req.user.email }, profile: profile.data, role: roles.data.role });
  } catch (error) { next(error); }
});

mazadAuthRouter.get('/buyer/dashboard', requireAuth, requireRole('buyer', 'seller', 'admin'), (_req, res) => {
  res.json({ message: 'Buyer area: access granted' });
});
mazadAuthRouter.get('/seller/dashboard', requireAuth, requireRole('seller', 'admin'), (_req, res) => {
  res.json({ message: 'Seller area: access granted' });
});
mazadAuthRouter.get('/admin/dashboard', requireAuth, requireRole('admin'), (_req, res) => {
  res.json({ message: 'Admin area: access granted' });
});
