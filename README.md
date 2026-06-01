# Prep Work

Prep Work is a no-dependency Node.js website for JEE mock test practice. Students can create accounts, practise published tests separately, receive instant marks, and review profile analytics. Hosts can log in to add, edit, publish, unpublish, and delete tests while the site is running.

## Features

- Student login and signup with password hashing and cookie-backed sessions.
- Independent mock test attempts stored per user.
- Instant score, topic-wise performance analysis, recent-attempt history, and a simple overall performance prediction.
- Host Studio for test CRUD operations, including question JSON editing and draft/published status.
- JSON-file persistence in `data/prep-work.json` so the app runs without external services.

## Run locally

```bash
npm start
```

Then open <http://localhost:3000>.

Demo host credentials:

- Email: `host@prepwork.test`
- Password: `host1234`

To create another host, sign up with host code `PREPWORK-HOST` or set a custom code with `HOST_CODE=your-code npm start`.
