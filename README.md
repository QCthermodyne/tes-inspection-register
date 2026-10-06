# TES Inspection Register

Job inspection app for **Thermodyne Engineering Systems**.

- **Admin** (PIN) – create new jobs, edit job details, delete jobs and tasks, and download the one-page **daily summary report** of all jobs for any date. A folder is created per Job No. + ORF No.
- **Job folders** – open a folder, tap **Create task**, choose the inspection category (Hydro Test, General Inspection, DP Test, PDIR, Final Inspection) and fill in the details.
- **Reports** – every task has its own PDF inspection report (tasks on the same date are never merged), plus an Excel register of all tasks.

Works on any phone browser; on Android choose **Add to Home screen** to use it like an app.

## How it runs

| Part | Where |
|---|---|
| App page | `public/index.html` (single page, no build step) |
| API | `api/*.js` – Vercel Functions |
| Data | Vercel Blob (private store) |

## Settings (Vercel → Project → Settings → Environment Variables)

| Name | Needed | What it is |
|---|---|---|
| `PIN_REQUIRED` | optional | Set to `1` to require a PIN. Without it, anyone with the link can use the app. |
| `APP_PIN` | yes | The admin PIN (unlocks the Admin section). Also the team PIN when `PIN_REQUIRED=1`. |
| `BLOB_READ_WRITE_TOKEN` | yes | Added automatically when the Blob store is connected. |

Redeploy after changing a variable.

No job data is stored in this repository.
