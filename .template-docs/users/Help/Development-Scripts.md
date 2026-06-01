# Running Your App

Run all commands from the project root using `npm --prefix web run <script>`.

---

## Starting the App

### Start the app in development mode

```bash
npm --prefix web run dev
```

Opens at http://localhost:3000. Changes to your files take effect immediately — no restart needed.

---

### Prepare your app for deployment

```bash
npm --prefix web run build
```

Checks your app for errors and prepares it for deployment. Output goes to `web/.next/`. Run this before deploying to a hosting platform like Vercel or Netlify.

---

### Run the deployed version locally

```bash
npm --prefix web run build
npm --prefix web run start
```

Lets you test the deployment-ready version of your app on your own machine before publishing it.

---

## Code Quality

Use Claude Code to run all checks at once:

```
/quality-check
```

---

## Testing

### Run all tests

```bash
npm --prefix web test
```

### Run tests and see a coverage report

```bash
npm --prefix web run test:coverage
```

### Run a single test file

```bash
npm --prefix web test -- path/to/file.test.tsx
```

---

**Need help?** Ask Claude Code about any command or workflow.
