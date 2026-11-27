# Security

## Design: no authentication

deal-search-ksa has **no login, no user accounts and no rate limiting, by design**. It is a
personal tool meant to run on your own machine, a trusted home network, or behind a private
tunnel or access layer (for example a Cloudflare Tunnel protected by Cloudflare Access, or a VPN).

Anyone who can reach the app can:

- run searches, which send requests to the stores from your server's IP address;
- read and delete your search history, price watches and alert log;
- send a test message to your Telegram chat, if Telegram is configured.

What the app does to limit exposure:

- `npm run dev` and `npm start` bind to `127.0.0.1` only.
- API routes reject a `Host` that is not loopback or listed in `APP_HOSTS`, cross-site
  `Sec-Fetch-Site` and foreign `Origin` headers (`src/lib/request-guard.ts`).
- Secrets (`TELEGRAM_BOT_TOKEN`, `TUNNEL_TOKEN`) are read from the environment only, are never
  sent to the browser or logged, and `.env*` files are gitignored and kept out of the Docker image.
- In Docker, Chrome runs with its sandbox enabled under a seccomp profile (`docker/`).

Do not expose the app directly to the internet. If you publish it through a tunnel, put an
authentication layer in front of it.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**Security > Advisories > Report a vulnerability** on
<https://github.com/drgoharyAI/deal-search-ksa/security/advisories/new>.

Do not open a public issue for a security problem. Include the affected version or commit, the
steps to reproduce, and the impact. You should get a reply within 7 days.

"Anyone on the network can use it" is the documented design above, not a vulnerability. Reports
about bypassing the request guard, leaking secrets, injection, or the Chrome sandbox are welcome.
