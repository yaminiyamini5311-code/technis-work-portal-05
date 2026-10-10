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

### 3. `CEO_EMAIL`
- **Purpose**: Email address for the CEO account (direct login access)
- **Example**: `ceo@techins.com`
- **Default**: `ceo@techins.com` (if not set)
- **Security**: Only this email can log in as CEO. No registration required.
- **IMPORTANT**: Set this in production to your actual CEO email

### 4. `CEO_PASSWORD`
- **Purpose**: Password for the CEO account
- **Example**: Use a strong password (min 12 characters)
- **Default**: `ceo@2006` (if not set)
- **Security**: **MUST be changed in production!** This is hashed with bcrypt (12 rounds)
- **CRITICAL**: Change this immediately in Vercel environment variables

### 5. `CORS_ORIGINS`
- **Purpose**: Comma-separated list of allowed frontend origins for CORS
- **Example**: `https://technis-work-portal-05-35bp.vercel.app,https://your-custom-domain.com`
- **Format**: No trailing slashes, comma-separated
- **REQUIRED**: Set this to your actual frontend URL(s) in Vercel
- **Note**: Prevents CORS errors when frontend calls backend APIs

## Optional Variables

### 5. `CORS_ORIGINS`
- **Purpose**: Comma-separated list of allowed frontend origins for CORS
- **Example**: `https://technis-work-portal-05-35bp.vercel.app,https://your-custom-domain.com`
- **Format**: No trailing slashes, comma-separated
- **REQUIRED for production**: Set this to your actual frontend URL(s) in Vercel
- **Note**: Prevents CORS errors when frontend calls backend APIs

### 6. `MONGODB_DB_NAME`
- **Purpose**: Name of the MongoDB database to use
- **Default**: `techins` (if not set)
- **Example**: `techins_production`

### 7. `CEO_NAME`
- **Purpose**: Display name for the CEO account
- **Default**: `TECHINS CEO` (if not set)
- **Example**: `John Doe`
- **Optional**: For customization

### 8. `NODE_ENV`
- **Purpose**: Environment mode (automatically set by Vercel to `production`)
- **Vercel default**: `production`
- **Local dev**: Not set or `development`

### 9. `FRONTEND_URL`
- **Purpose**: Additional allowed CORS origins (comma-separated) - **DEPRECATED**
- **Example**: `https://my-custom-domain.com,https://another-domain.com`
- **Note**: Use `CORS_ORIGINS` instead (this is kept for backward compatibility)

### 10. `PORT`
- **Purpose**: Port number for local development server
- **Default**: `5000` (only used in local development, ignored on Vercel)

### 10. `APP_URL`
- **Purpose**: Base URL for email links in task assignment notifications
- **Example**: `https://technis-work-portal-05.vercel.app`
- **Default**: `http://localhost:5173` (if not set)

### 11. `RESEND_API_KEY`
- **Purpose**: API key for Resend email service (task notifications)
- **Default**: Email notifications are skipped if not set
- **Optional**: Only needed if you want email notifications

### 12. `EMAIL_FROM`
- **Purpose**: Sender email address for task notifications
- **Example**: `notifications@techins.com`
- **Default**: Email notifications are skipped if not set
- **Optional**: Required only if RESEND_API_KEY is set

### 13. `ALLOWED_STUDENT_EMAILS`
- **Purpose**: Comma-separated list of approved student emails
- **Example**: `student1@example.com,student2@example.com`
- **Optional**: For student registration allowlist feature

### 14. `ADMIN_EMAIL`
- **Purpose**: Email address for the default admin account
- **Default**: `admin@techins.com` (if not set)
- **Example**: `admin@yourdomain.com`
- **Optional**: Only create separate admin if needed (not same as CEO)

### 15. `ADMIN_PASSWORD`
- **Purpose**: Password for the default admin account
- **Default**: `Admin@123` (if not set)
- **Example**: Use a strong password (min 12 characters)
- **Optional**: **Recommended** to set for production if using admin account

### 16. `ADMIN_NAME`
- **Purpose**: Display name for the default admin account
- **Default**: `TECHINS Admin` (if not set)
- **Example**: `System Administrator`
- **Optional**: For customization

### 17. `MANAGER_EMAIL`
- **Purpose**: Email address for the default manager account
- **Default**: `manager@techins.com` (if not set)
- **Example**: `manager@yourdomain.com`
- **Optional**: Recommended to set for production

### 18. `MANAGER_PASSWORD`
- **Purpose**: Password for the default manager account
- **Default**: `Manager@123` (if not set)
- **Example**: Use a strong password (min 12 characters)
- **Optional**: **Strongly recommended** to set for production security

### 19. `MANAGER_NAME`
- **Purpose**: Display name for the default manager account
- **Default**: `TECHINS Manager` (if not set)
- **Example**: `Project Manager`
- **Optional**: For customization

### 20. `MANAGER_DEPARTMENT`
- **Purpose**: Department for the default manager account
- **Default**: `Techins` (if not set)
- **Example**: `Management`
- **Optional**: For customization

---

## Vercel Configuration Checklist

Before deploying, ensure these are set in Vercel:

```
✅ JWT_SECRET          (REQUIRED)
✅ MONGODB_URI         (REQUIRED)
✅ CEO_EMAIL           (REQUIRED - set to your CEO email)
✅ CEO_PASSWORD        (REQUIRED - MUST change in production!)
✅ CORS_ORIGINS        (REQUIRED for production - your frontend URL)
□  CEO_NAME            (optional, for customization)
□  MONGODB_DB_NAME     (optional, defaults to "techins")
□  FRONTEND_URL        (optional, deprecated - use CORS_ORIGINS)
□  APP_URL             (optional, for email links)
□  RESEND_API_KEY      (optional, for emails)
□  EMAIL_FROM          (optional, for emails)
□  ALLOWED_STUDENT_EMAILS (optional)
□  ADMIN_EMAIL         (optional, if separate admin needed)
□  ADMIN_PASSWORD      (optional, but RECOMMENDED if using admin)
□  ADMIN_NAME          (optional, for customization)
□  MANAGER_EMAIL       (optional, but RECOMMENDED for production)
□  MANAGER_PASSWORD    (optional, but STRONGLY RECOMMENDED for production)
□  MANAGER_NAME        (optional, for customization)
□  MANAGER_DEPARTMENT  (optional, for customization)
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

### Error: "E11000 duplicate key error" during account seeding
- **Solution**: This is now handled automatically with upsert
- **Result**: Existing accounts are preserved, new accounts are created only if missing
- **Non-fatal**: Server will continue initialization even if seeding fails

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
