# Environment Variables

Environment variables are settings that configure your app — things like which server to connect to. They are stored in a file called `.env.local` in the `web/` folder. This file is private to your machine and is never uploaded to GitHub, which makes it a safe place to store sensitive settings.

`.env.local` is created for you automatically when you set up the project. The two settings you may need to change are:

---

## `NEXT_PUBLIC_API_BASE_URL`

The address of the backend server your app talks to.

| Environment | Value |
|---|---|
| Development (your machine) | `http://localhost:8042` |
| Production (live site) | The URL your backend team or hosting provider gives you |

## `NEXTAUTH_URL`

The address of your app itself.

| Environment | Value |
|---|---|
| Development (your machine) | `http://localhost:3000` |
| Production (live site) | `https://yourdomain.com` |

---

**Need more help?** Ask Claude Code: *"How do I configure my environment variables?"*
