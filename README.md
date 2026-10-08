Panel Sell Bazaar - Admin Background Push Update

Files:
1. admin_push_ready.html -> replace the current admin.html on GitHub Pages.
2. psb-admin-sw.js -> upload to the same folder as admin.html.

Buyer files are not changed.

After upload:
- Open Admin page while logged in.
- Allow notification permission when Android/browser asks.
- The page registers the service worker and saves the admin push subscription.
- Notifications inserted into public.Notifications are sent by the send-admin-push Edge Function.

Important Supabase webhook note:
Supabase's current docs show webhook receivers should be configured for webhook authentication and, when JWT verification is disabled, the function should validate the webhook secret itself. If the webhook test fails with 401/403, check the send-admin-push function authentication setting and webhook header configuration before changing buyer code.
