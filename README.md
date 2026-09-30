# Integrated Government Services System — HCI Prototype

**Design and Prototyping of an Integrated Government Services System Connecting Home Affairs
with Traffic, Finance, Pensions, Police and Passport Services**

A high-fidelity, database-driven interactive prototype built for a university HCI assignment
(BIHC3110). This is **not** a static mockup — it is a real client/server application with a
PostgreSQL database, a Node/Express REST API, and a React (Vite) frontend.

> ⚠️ **Prototype / Demonstration Data.** Every citizen, employee, and record in this system is
> fictional and generated for demonstration purposes only. No real personal information is used.

## Monorepo layout

```
gov-services-prototype/
├── database/     PostgreSQL migrations + seed data
├── backend/      Node.js + Express REST API (JWT auth, RBAC, audit logging)
├── frontend/     React + Vite SPA (bilingual EN/ST, accessible, responsive)
└── docs/         Architecture notes
```

## Quick start

### 1. Database

```bash
createdb gov_services
cd database
cp .env.example .env   # if present, else export DATABASE_URL directly
node run-migrations.js
node seed/seed.js
```

### 2. Backend API

```bash
cd backend
cp .env.example .env   # set DATABASE_URL, JWT_SECRET
npm install
npm run dev             # http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev              # http://localhost:5173
```

### Demo logins (see `database/seed/seed.js` for the full list)

| Role | Email | Password |
|---|---|---|
| Citizen (verified) | thabo.mokoena@example.ls | Passw0rd! |
| Citizen (provisional) | palesa.new@example.ls | Passw0rd! |
| Home Affairs Officer | officer.homeaffairs@gov.ls | Passw0rd! |
| Traffic Officer | officer.traffic@gov.ls | Passw0rd! |
| Finance Officer | officer.finance@gov.ls | Passw0rd! |
| Pensions Officer | officer.pensions@gov.ls | Passw0rd! |
| Police Officer | officer.police@gov.ls | Passw0rd! |
| Passport Officer | officer.passport@gov.ls | Passw0rd! |
| System Administrator | admin@gov.ls | Passw0rd! |

See `docs/ARCHITECTURE.md` for the full data model, API surface, and design rationale, and
`docs/FILE_STRUCTURE.md` for the complete file tree.
