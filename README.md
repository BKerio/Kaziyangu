# Millenium Task Sheet

Millenium Solutions E.A Ltd.'s internal task management system, known around the office by its Swahili nickname **"Kazi Yangu"** ("my work"). An internal web app for logging daily work, tracking a sales opportunity pipeline, running an attachee/intern attendance-and-logbook program, and coordinating a small team's calendar, with an optional WhatsApp bot for logging tasks on the go. Originally modelled on a "Master Daily Tasks" spreadsheet.

- **Backend:** [backend/](backend/), Node.js + Express 5 + TypeScript, PostgreSQL via Prisma, JWT auth, Socket.io for realtime notifications.
- **Frontend:** [frontend/](frontend/), React 19 + TypeScript + Vite, Tailwind CSS, React Router, TanStack Query, Zustand.

## Features

- **Task logging**: staff log daily work against 12 org verticals (Applications & Databases, Infrastructure, Networking, …), with status, % complete, hours spent, and screenshot/PDF attachments.
- **Task reminders**: opt-in nudges before a task is due, delivered by SMS, email, and/or WhatsApp, on a repeating schedule until the task is closed or the repeats run out.
- **Team task view & reports**: managers see the whole team's tasks, plus weekly resource and vertical-summary reports.
- **Opportunity tracker**: a sales pipeline (New → Qualification → Assigned → Engagement → Proposal → Negotiation → Won/Lost) with per-opportunity activity logs and document attachments.
- **Attachment (internship) management**: attendance tracking, a daily logbook with supervisor review/rating, managed by supervising staff for their assigned attachees.
- **Team calendar**: a shared "who's out" out-of-office calendar.
- **Admin**: user management, org-wide audit log.
- **WhatsApp bot** (optional): a conversational flow (Meta Cloud API) for logging tasks from WhatsApp.
- **Microsoft/Outlook login** (optional): OAuth account linking and calendar read access.
- Realtime notifications over Socket.io.

## Tech stack

| | Backend | Frontend |
|---|---|---|
| Language | TypeScript | TypeScript |
| Framework | Express 5 | React 19 + Vite |
| Data | PostgreSQL + Prisma ORM (`pg` driver adapter) | TanStack Query, Axios |
| Auth | JWT (`jsonwebtoken`), bcrypt | Zustand session store |
| Realtime | Socket.io | socket.io-client |
| Styling | n/a | Tailwind CSS v4 |
| Other | Zod validation, Multer uploads, Pino logging, Nodemailer | React Hook Form + Zod resolvers, React Router, Recharts, SweetAlert2 |

## Roles

`SUPER_ADMIN`, `ADMIN`, `STAFF`, `ATTACHEE`, enforced both by backend route guards (`requireRole`) and frontend route guards (`RoleGuard`).

## Project structure

```
backend/
  src/
    modules/          # auth, admin, tasks, attachments, opportunities, team-calendar, reminders, whatsapp, audit
    middleware/        # auth, error handling, file upload
    lib/                # env validation, JWT, logging, Prisma client, Socket.io
    shared/             # error classes, guards, schemas, types, utils
  prisma/schema.prisma  # data model
frontend/
  src/
    pages/             # one folder per feature area (tasks, opportunities, admin, attachee, staff, reports, ...)
    components/        # layout, shared, and feature-specific components
    api/                # Axios client + typed API calls
    stores/             # Zustand stores (auth, notifications)
    router/index.tsx    # route table + role guards
```

## Data model

Defined in [backend/prisma/schema.prisma](backend/prisma/schema.prisma):

`User` (with optional attachee profile fields and a supervisor relation), `MicrosoftAccount`, `OutOfOffice`, `Attendance`, `TaskReport` (the attachee logbook), `Opportunity` + `OpportunityActivity` + `OpportunityAttachment`, `WorkTask` (the daily task log) + `TaskAttachment`, `TaskReminder` + `TaskReminderLog`, `BotSession` (WhatsApp conversation state), `AuditLog`.

## API

All routes are mounted in [backend/src/app.ts](backend/src/app.ts). Base path is the API root (e.g. `http://localhost:3000`); most routes require `Authorization: Bearer <jwt>`.

| Prefix | Routes | Purpose |
|---|---|---|
| `/auth` | `POST /register`, `POST /login`, `GET /me`, `PATCH /me`, `GET /microsoft/login`, `GET /microsoft/callback`, `GET /microsoft/status`, `DELETE /microsoft/connection`, `GET /microsoft/calendar` | Registration, login, profile, Microsoft OAuth linking |
| `/admin` | `GET/POST /users`, `GET/PATCH/DELETE /users/:id`, `GET /audit-logs` | User management, audit log (Admin/Super Admin) |
| `/tasks` | `GET /options`, `GET /my-stats`, `GET /reports/resource-weekly`, `GET /reports/vertical-weekly`, `GET /reports/org-overview`, `POST /`, `GET /`, `GET/PATCH/DELETE /:id`, `GET/POST /:id/attachments`, `GET/DELETE /:id/attachments/:attachmentId` | Daily task CRUD, reports, attachments |
| `/attachments` | `/attachees*`, `/my-attachees`, `/attendance*`, `/reports*` | Attachee profiles, attendance, logbook reports |
| `/opportunities` | `GET /stats`, `GET/POST /`, `GET/PATCH/DELETE /:id`, `POST /:id/activities`, `GET/POST /:id/attachments`, `GET/DELETE /:id/attachments/:attachmentId` | Sales pipeline CRUD, activity log, attachments |
| `/team-calendar` | `GET/POST /`, `DELETE /:id` | Out-of-office calendar |
| `/reminders` | `GET/POST /`, `PATCH/DELETE /:id` | Task reminders |
| `/whatsapp` | `GET/POST /webhook` | Meta Cloud API webhook |

`/auth` and `/whatsapp` are also mounted under `/api/auth` and `/api/whatsapp` to match external callback URLs already configured (Azure app registration, Meta App dashboard).

## Getting started

### Prerequisites
- Node.js 20+
- A PostgreSQL database

### Backend

```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET at minimum
npm install
npx prisma generate
npx prisma db push     # or migrate, once you have migrations
npm run dev             # http://localhost:3000
```

Required env vars: `DATABASE_URL`, `JWT_SECRET`. Everything else (`PORT`, `HOST`, `NODE_ENV`, `LOG_LEVEL`, `CORS_ORIGIN`, `JWT_EXPIRES_IN`, WhatsApp, SMS, SMTP) is optional, see [backend/.env.example](backend/.env.example); optional integrations stay disabled until their vars are set.

### Frontend

```bash
cd frontend
cp .env.example .env    # set VITE_API_BASE_URL and VITE_SOCKET_URL to the backend URL
npm install
npm run dev              # Vite dev server
```

## Scripts

**Backend** (`backend/package.json`): `npm run dev` (nodemon + tsx), `npm run build` (Prisma generate + tsc), `npm start` (run compiled build).
**Frontend** (`frontend/package.json`): `npm run dev`, `npm run build` (tsc -b + vite build), `npm run lint`, `npm run preview`.

## Notes

- [backend/docs.md](backend/docs.md) is a historical build log from an earlier, unrelated product (an ambulance-dispatch API) that this service was repurposed from; most of it no longer applies. The Prisma schema and route files are the source of truth for the current API.
