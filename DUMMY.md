# Dummy Demo Setup (Current)

This file is the source of truth for demo users, credentials, and calendar/invite behavior.

## 1) Seed demo data

```bash
npm run seed:full-demo
```

This seeds org `org_yhack26` with members and sample PR/ticket/message/calendar data.

## 2) Demo accounts (real emails)

For local demo only, password is set to the same value as email in the seeder.

| Name   | User ID | Email                     | Password                | Role    |
|--------|---------|---------------------------|-------------------------|---------|
| Dharma | ds3519  | ds3519@rit.edu            | ds3519@rit.edu          | manager |
| Keshav | ks2992  | ks2992@rit.edu            | ks2992@rit.edu          | member  |
| Veda   | veda    | vedakesarwani@gmail.com   | vedakesarwani@gmail.com | member  |
| Sai    | sai     | sairaparla@gmail.com      | sairaparla@gmail.com    | member  |

## 3) Expected org behavior

- Team/member queries should resolve directly from org roster:
  - "Tell me about my team"
  - "Tell me about Sai"
  - "Who is Veda?"
- Scheduling should only allow org members.
- Booking should use stored roster emails (no guessed `name@domain` addresses).

## 4) GitHub dummy PR process (manual demo)

Use your dummy repo (example: `https://github.com/dharmateja03/Dummy.git`):

```bash
git clone https://github.com/dharmateja03/Dummy.git
cd Dummy
git checkout -b feat/demo-pr-1
echo "demo change 1" >> demo.txt
git add .
git commit -m "feat: demo PR 1"
git push -u origin feat/demo-pr-1
```

Then open a PR in GitHub UI. Repeat with 3-5 branches to create realistic PR history.

## 5) Nylas keys: do you need one per account?

Short answer: **for accurate per-person calendars, yes (recommended).**

- Minimum to send invites:
  - One valid Nylas credential for the organizer account can create/send events.
- Accurate multi-person availability/rescheduling:
  - Each member should connect their own calendar via Nylas (or equivalent per-user grant),
  - otherwise the system cannot reliably reflect each person’s real busy/free calendar.

So for your 4-member org demo, best setup is all 4 members connect calendar access.

## 6) Quick verification checklist

1. `GET /api/users/me?lite=1` returns correct logged-in `userId`.
2. `GET /api/orgs/me` shows all 4 members above.
3. Ask: "Schedule a meet with Sai today at 3:30 PM" and confirm invite uses `sairaparla@gmail.com`.
4. Ask: "Tell me about Sai" and confirm direct answer with no follow-up.

