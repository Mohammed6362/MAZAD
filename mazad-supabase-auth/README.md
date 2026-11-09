# Mazad — Supabase Auth and protected Express routes

## Database status
Already deployed to Supabase project `aqjizwdhplchotvlpmip`:
- `public.profiles`: own-profile read, restricted-column own-profile update.
- `public.user_roles`: own-role read only. New users default to `buyer`.
- Signup trigger creates both records.
- RLS is enabled; security advisor reports no warnings after migration.

## Run the standalone integration sample

1. Install Node.js 20+.
2. Run `npm install` and commit your resulting `package-lock.json`. Pin the resolved versions before deploying.
3. Copy `.env.example` to `.env` and put the current **publishable** key from Supabase's API settings in it. Do not add a service_role key.
4. Run `npm start`.
5. For the real Mazad app, mount `mazadAuthRouter` in its existing Express server instead of starting the sample.

### Routes
- `POST /api/signup`: `{ "email": "...", "password": "...", "full_name": "..." }`
- `POST /api/login`: same credentials; returns user and session.
- `GET /api/me`: requires `Authorization: Bearer ACCESS_TOKEN`.
- `GET /api/buyer/dashboard`: buyer, seller, admin.
- `GET /api/seller/dashboard`: seller or admin.
- `GET /api/admin/dashboard`: admin only.

Sign out on the browser using `supabase.auth.signOut()` and discard any stored access token. For high-risk changes use short-lived tokens and session revocation as appropriate. The sample's login response delivers tokens in JSON; for a production browser app, prefer a secure httpOnly-cookie/BFF architecture with CSRF protections or an appropriately secured SSR integration.

## Browser integration
Use the Supabase browser client with the publishable key and let it handle session refresh. Submit the user's `session.access_token` in the `Authorization` header to protected Express routes. Never treat client-side hiding or JWT decoding as your authorization boundary; server guard + database RLS are the boundary.

## Admin / seller promotion
Do not expose an API to update `public.user_roles` directly from the browser. An authorized operator can assign roles through a trusted administrative process, e.g. in Supabase SQL Editor:

```sql
-- Replace with a verified user's actual UUID; restrict access to authorized operators.
update public.user_roles set role = 'seller' where user_id = 'REPLACE_WITH_USER_UUID';
```

Only do this after reviewing seller eligibility. Admin assignment must be even more tightly controlled.

## Required Supabase Dashboard configuration
In Authentication > Providers enable Email if not enabled. Configure Auth > URL Configuration with the app's production origin and exact redirect URLs. Configure an SMTP provider for production emails and keep email confirmations enabled. The MCP connector cannot currently make these dashboard-only configuration changes. Add rate limits, abuse protections, reset-password, and real frontend forms before production rollout.

## Important
This is a ready-to-integrate Express module, not a change to Mazad source code. No linked GitHub repository was accessible to apply it automatically. Replace the dashboard example handlers with actual app logic and enforce resource ownership on every auction/bid mutation too.
