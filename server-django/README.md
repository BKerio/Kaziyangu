# Org Task Management API — Django

A Django port of `../backend` (Express + Prisma). Same routes, same JSON
shapes (`{ ok, data, meta }`, camelCase, ISO dates), same error messages, same
database tables, and the same JWTs, so the existing frontend can point at either server.

## Run

```bash
venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # or copy backend/.env - same variables
python manage.py migrate        # new, empty database
python manage.py serve          # HTTP + Socket.io + reminder scheduler on HOST:PORT
```

**Using the existing Prisma database:** the models map onto the Prisma tables
exactly, so mark the initial migrations as applied instead of creating tables:

```bash
python manage.py migrate --fake-initial
```

`python manage.py runserver` also works for quick HTTP-only checks, but it has
no Socket.io and no reminder scheduler. Use `serve` for anything real.

## Commands

| Node (`backend/`)                     | Django (`server-django/`)                         |
|---------------------------------------|---------------------------------------------------|
| `npm start` / `npm run dev`           | `python manage.py serve` / `serve --reload`       |
| `npx prisma db seed`                  | `python manage.py seed`                           |
| `scripts/create-user.ts`              | `python manage.py create_user <email> <pw> <name> [role]` |
| `scripts/set-super-admin.ts`          | `python manage.py set_super_admin <email>`        |
| `scripts/subscribe-waba.ts`           | `python manage.py subscribe_waba`                 |

## Layout

```
config/          settings, urls (one catch-all), asgi (Django + Socket.io + scheduler)
core/            lib + middleware + shared from the Node app:
                 env, jwt, logger, errors, enums, validation (zod-like), router
                 (Express-like), app (CORS, security headers, 404, error handler),
                 realtime (Socket.io), crypto, hashing, storage, upload
modules/         one package per backend module, each with service.py + routes.py
  auth/ admin/ audit/ tasks/ attachments/ opportunities/ team_calendar/
  reminders/ campaigns/ settings/ whatsapp/
  routes.py      the mount table (app.use(...) in app.ts)
```
