# Environment Variables for Vercel Deployment

This document lists all environment variables used by the TECHINS Work Portal backend.

## Required Variables (MUST be set in Vercel)

These variables MUST be configured in Vercel Dashboard → Settings → Environment Variables for the app to function:

### 1. `JWT_SECRET`
- **Purpose**: Secret key for signing JSON Web Tokens (authentication)
- **Example**: `your-super-secure-random-string-here-min-32-chars`
- **How to generate**: Run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- **Security**: Keep this secret and never commit to git

### 2. `MONGODB_URI`
- **Purpose**: Connection string for MongoDB database
- **Example**: `mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority`
- **How to get**: From MongoDB Atlas → Connect → Drivers → Connection String
- **Note**: Include username, password, and cluster address

## Optional Variables

### 3. `MONGODB_DB_NAME`
- **Purpose**: Name of the MongoDB database to use
- **Default**: `techins` (if not set)
- **Example**: `techins_production`

### 4. `NODE_ENV`
- **Purpose**: Environment mode (automatically set by Vercel to `production`)
- **Vercel default**: `production`
- **Local dev**: Not set or `development`

### 5. `FRONTEND_URL`
- **Purpose**: Additional allowed CORS origins (comma-separated)
- **Example**: `https://my-custom-domain.com,https://another-domain.com`
- **Default**: Pre-configured list in server.js includes common Vercel domains

### 6. `PORT`
- **Purpose**: Port number for local development server
- **Default**: `5000` (only used in local development, ignored on Vercel)

### 7. `APP_URL`
- **Purpose**: Base URL for email links in task assignment notifications
- **Example**: `https://technis-work-portal-05.vercel.app`
- **Default**: `http://localhost:5173` (if not set)

### 8. `RESEND_API_KEY`
- **Purpose**: API key for Resend email service (task notifications)
- **Default**: Email notifications are skipped if not set
- **Optional**: Only needed if you want email notifications

### 9. `EMAIL_FROM`
- **Purpose**: Sender email address for task notifications
- **Example**: `notifications@techins.com`
- **Default**: Email notifications are skipped if not set
- **Optional**: Required only if RESEND_API_KEY is set

### 10. `ALLOWED_STUDENT_EMAILS`
- **Purpose**: Comma-separated list of approved student emails
- **Example**: `student1@example.com,student2@example.com`
- **Optional**: For student registration allowlist feature

---

## Vercel Configuration Checklist

Before deploying, ensure these are set in Vercel:

```
✅ JWT_SECRET          (REQUIRED)
✅ MONGODB_URI         (REQUIRED)
□  MONGODB_DB_NAME     (optional, defaults to "techins")
□  FRONTEND_URL        (optional, for custom domains)
□  APP_URL             (optional, for email links)
□  RESEND_API_KEY      (optional, for emails)
□  EMAIL_FROM          (optional, for emails)
□  ALLOWED_STUDENT_EMAILS (optional)
```

## How to Set Environment Variables in Vercel

1. Go to your Vercel dashboard: https://vercel.com/dashboard
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Click **Add New**
5. Enter the variable name (e.g., `JWT_SECRET`)
6. Enter the value
7. Select which environments (Production, Preview, Development)
8. Click **Save**
9. **Redeploy** your application after adding variables

## Troubleshooting

### Error: "Missing required environment variables: JWT_SECRET, MONGODB_URI"
- **Solution**: Set these variables in Vercel → Settings → Environment Variables
- **Check**: Visit `/api/health?check=config` to verify configuration

### Error: "MongoDB connection failed"
- **Check**: Verify MONGODB_URI is correct
- **Check**: MongoDB Atlas allows connections from all IPs (0.0.0.0/0) for Vercel
- **Check**: Database user has read/write permissions

### Error: "JWT_SECRET is not configured"
- **Solution**: Add JWT_SECRET in Vercel environment variables
- **Must redeploy** after adding

## Testing Health Endpoints

After deployment, test these endpoints:

```bash
# Basic health (no DB check)
curl https://your-app.vercel.app/api/health

# Check configuration
curl https://your-app.vercel.app/api/health?check=config

# Full health check (includes database)
curl https://your-app.vercel.app/api/health?check=all
```

Expected response (healthy):
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2024-10-10T12:00:00.000Z",
  "env": "production"
}
```
