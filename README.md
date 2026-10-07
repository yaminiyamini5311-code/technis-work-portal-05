# TECHINS WORK PORTAL

Professional internal work and task management portal for TECHINS.

## Core workflow

**Assign → Execute → Submit → Verify → Review → Improve → Approve → Record → Analyze**

The system is designed around one rule: important organizational actions must be stored, validated, authorized, timestamped and traceable.

## Recent Updates

### Latest Features (v1.0)
- ✅ **API Integration Fixed** - Resolved all 404 errors and unified API endpoints
- ✅ **Enhanced Loading Experience** - Professional loading page with TECHINS branding
- ✅ **Improved UI Contrast** - WCAG AA compliant color contrast for better accessibility
- ✅ **3D Text Effects** - Interactive hover effects on text boxes with smooth transitions
- ✅ **Light Theme Only** - Streamlined design with consistent light theme
- ✅ **Enhanced Logo Animation** - More prominent glow effect with smooth, professional animation
- ✅ **Responsive Design** - Optimized for all screen sizes (360px to 1440px+)
- ✅ **Unified Navigation** - Consistent sidebar and navbar across all roles

## Stack

- Frontend: React 19 + Vite + React Router
- Backend: Node.js + Express
- Local database: SQLite through Node.js `node:sqlite` (Node 22+)
- Authentication: JWT + bcryptjs
- Uploads: protected server-side storage for local development
- Deployment: Vercel-ready frontend and Render/Node-host-ready backend

## Roles

- **Admin** — user management, task control, missions, feedback, performance and operational oversight.
- **Manager** — team activity monitoring, assigned-task operations and submission review for tasks they manage.
- **Student** — assigned work, daily activity, missions, submissions, feedback and private performance.

## Important capabilities

- Backend-enforced role authorization
- Maximum 25 active students
- Human-readable task IDs such as `TNS-2026-0001`
- Controlled task lifecycle with submission/review/revision/approval states
- Server-generated submission timestamps
- Submission version history (`V1`, `V2`, ...)
- Protected student file access
- In-app notifications
- Audit logs and task status history
- Database-derived dashboard/performance metrics
- Daily activity records
- Responsive UI with reduced-motion support
- TECHINS brand colors: `#B7B7B7`, `#0C120C`, `#FA9A02`
- Interactive 3D text effects on hover
- Professional loading animations
- WCAG AA accessibility compliance
- Unified API architecture with proper error handling

## UI/UX Features

### Visual Design
- **Light Theme**: Clean, professional interface with optimal contrast
- **Brand Colors**: Consistent use of TECHINS orange (#FA9A02) for accents
- **Enhanced Logo**: Smooth glow animation that's prominent yet professional
- **3D Effects**: Text boxes shift smoothly on hover for interactive feel
- **Loading Page**: Branded loading experience with animated logo

### Accessibility
- WCAG AA contrast ratios (4.5:1 minimum for text)
- Keyboard navigation support with visible focus states
- Touch-friendly targets (44px minimum)
- Reduced motion support for users with vestibular disorders
- Semantic HTML structure
- Screen reader compatible

### Responsive Breakpoints
- Mobile: 360px - 507px
- Tablet: 768px
- Desktop: 1024px - 1440px+

## Local setup

### Prerequisites
- Node.js 22+ (for native SQLite support)
- npm or yarn package manager
- Git

### 1. Backend

```powershell
cd server
npm install
Copy-Item .env.example .env
```

Set a strong `JWT_SECRET` in `server/.env`.

Create an admin account without putting its password in source control:

```powershell
node create-admin.js ceo@techins.com "CHANGE_THIS_PASSWORD" "TECHINS Admin"
```

Optional manager:

```powershell
node create-manager.js manager@techins.com "CHANGE_THIS_PASSWORD" "TECHINS Manager"
```

Start the backend:

```powershell
npm run dev
```

Health check: `http://localhost:5000/api/health`

**Backend Routes:**
- `/api/auth/*` - Authentication endpoints
- `/api/students/*` - Student management
- `/api/admin/*` - Admin operations (stats, progress, student creation)
- `/api/tasks/*` - Task and submission management
- `/api/notifications/*` - User notifications
- `/api/audit/*` - Audit log access

### 2. Frontend

```powershell
cd client
npm install
Copy-Item .env.example .env
```

Set:

```text
VITE_API_URL=http://localhost:5000
```

Start:

```powershell
npm run dev
```

Open the Vite URL shown in the terminal (usually `http://localhost:5173`).

### 3. Testing the Application

**Login Credentials:**
- Admin: `ceo@techins.com` / (password set during admin creation)
- Manager: `manager@techins.com` / (password set during manager creation)
- Students: Created by admin through the UI

## Environment variables

### Backend

See `server/.env.example`.

- `PORT`
- `JWT_SECRET`
- `CLIENT_URL`
- `APP_URL`
- `RESEND_API_KEY` (optional)
- `EMAIL_FROM` (optional)

### Frontend

- `VITE_API_URL`

Never put backend secrets in `VITE_*` variables.

## Deployment

### Frontend — Vercel

Build command:

```text
npm run build
```

Set `VITE_API_URL` to the deployed backend origin, for example:

```text
https://your-backend.example.com
```

The client contains `vercel.json` for SPA routing.

### Backend — Render or another Node host

Start command:

```text
npm start
```

Set the backend environment variables from `server/.env.example`.

**Important:** local SQLite and local `server/uploads` are intended for development/small local deployments. For production growth, move the database to PostgreSQL and file uploads to persistent object storage (for example Vercel Blob or another private object-storage provider), while keeping the same metadata/authorization model.

## Git hygiene

Do not commit:

- `.env`
- `node_modules/`
- `dist/`
- `*.db`
- `*.db-wal`
- `*.db-shm`
- `server/uploads/`
- passwords or API keys

Use the provided `.env.example` files as templates.

## Validation checklist

- Backend syntax checks pass.
- Backend health endpoint responds.
- Protected APIs reject unauthenticated requests.
- Frontend uses `VITE_API_URL` rather than a hard-coded production URL.
- Student ownership is enforced by the backend.
- File downloads are authorization checked.
- Task submissions use server timestamps and versioning.
- Audit records are written for important workflow events.

## Development order

Audit → setup → database → authentication → roles/permissions → users → teams/programs → tasks → assignments → student dashboard → submission/proof → review → revision → approval → notifications → audit logs → admin command center → search/filters → reports → responsive design → animations/polish → security testing → end-to-end testing → deployment.

## Project Structure

```
technis-work-portal-05/
├── client/                    # React frontend
│   ├── src/
│   │   ├── components/       # Reusable components
│   │   │   ├── LoadingPage.jsx
│   │   │   ├── Navbar.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   └── ...
│   │   ├── pages/           # Page components
│   │   │   ├── admin/       # Admin-specific pages
│   │   │   ├── student/     # Student-specific pages
│   │   │   ├── manager/     # Manager-specific pages
│   │   │   └── Login.jsx
│   │   ├── styles/          # Global styles
│   │   │   ├── 3d-effects.css
│   │   │   ├── theme.css
│   │   │   ├── buttons.css
│   │   │   └── ...
│   │   ├── App.jsx          # Main app component
│   │   └── main.jsx         # Entry point
│   ├── public/              # Static assets
│   └── package.json
│
└── server/                   # Node.js backend
    ├── routes/              # API routes
    │   ├── adminRoutes.js
    │   ├── studentsRoutes.js
    │   ├── taskRoutes.js
    │   ├── notificationRoutes.js
    │   └── auditRoutes.js
    ├── middleware/          # Auth and validation
    ├── models/              # Database models
    ├── uploads/             # File storage
    ├── server.js            # Express server
    └── package.json
```

## Troubleshooting

### Common Issues

**1. API 404 Errors**
- Ensure backend is running on port 5000
- Check `VITE_API_URL` in client `.env` matches backend URL
- Verify no stale backend processes are running

**2. Authentication Issues**
- Clear browser localStorage
- Verify JWT_SECRET is set in backend `.env`
- Check token expiration settings

**3. Database Issues**
- Delete `*.db*` files and restart backend to recreate
- Ensure Node.js version is 22+ for SQLite support

**4. UI Not Loading Properly**
- Clear browser cache
- Run `npm install` in both client and server directories
- Check browser console for errors

**5. Port Already in Use**
```powershell
# Kill process on port 5000 (backend)
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Kill process on port 5173 (frontend)
netstat -ano | findstr :5173
taskkill /PID <PID> /F
```

## Contributing

1. Create a feature branch from `main`
2. Make your changes following the existing code style
3. Test all role-based functionality (Admin, Manager, Student)
4. Ensure no console errors or warnings
5. Update documentation if needed
6. Submit a pull request with clear description

## License

Proprietary - Internal use only for TECHINS

## Support

For issues or questions, contact the TECHINS development team.

---

**Built with ❤️ by the TECHINS Team**
