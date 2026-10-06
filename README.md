# TES Inspection Register

Job inspection app for **Thermodyne Engineering Systems**.

- **New job** – enter the job details once; a folder is created per Job No. + ORF No.
- **Job folders** – open a folder, tap **Create task**, capture a photo, fill in the details and observation.
- **Reports** – download a standard PDF inspection report (whole job or one day) and an Excel register. Photos are kept in the folder but not printed in the PDF.

Works on any phone browser; on Android choose **Add to Home screen** to use it like an app.

## How it runs

| Part | Where |
|---|---|
| App page | `public/index.html` (single page, no build step) |
| API | `api/*.js` – Vercel Functions |
| Data and photos | Vercel Blob (private store) |
| Photo suggestions | Anthropic API (optional) |

## Settings (Vercel → Project → Settings → Environment Variables)

| Name | Needed | What it is |
|---|---|---|
| `PIN_REQUIRED` | optional | Set to `1` to require a PIN. Without it, anyone with the link can use the app. |
| `APP_PIN` | optional | The team PIN, used only when `PIN_REQUIRED=1`. |
| `BLOB_READ_WRITE_TOKEN` | yes | Added automatically when the Blob store is connected. |
| `ANTHROPIC_API_KEY` | optional | Turns on **Suggest details from photo**. |
| `ANTHROPIC_MODEL` | optional | Model for suggestions (default `claude-sonnet-5-5`). |

Redeploy after changing a variable.

No job data is stored in this repository.
