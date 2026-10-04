# TECHINS Work Portal — Frontend

React/Vite frontend for the TECHINS Work Portal.

## Development

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Set `VITE_API_URL` to the backend origin, for example `http://localhost:5000`.

## Production

```powershell
npm run build
```

Deploy the `client` directory to Vercel and configure `VITE_API_URL` in the Vercel project environment variables.
