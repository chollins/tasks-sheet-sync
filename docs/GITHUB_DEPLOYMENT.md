# Deploy from GitHub

The **Deploy to Apps Script** workflow uploads `src/` to your existing bound script. It runs manually from `main`, tests first, uses two repository secrets, and deletes temporary configuration/credential files. No web-app deployment is needed.

## One-time manual setup

### 1. Authorize Google on your computer

Create the Sheet's bound project through **Extensions → Apps Script** if you have not already. Copy its **Script ID** from **Project Settings**. Enable the **Google Apps Script API** at [Apps Script user settings](https://script.google.com/home/usersettings).

In your local clone, using Node.js 20+:

```sh
git pull --ff-only
npm ci
npx clasp --auth .clasprc.json login
```

Sign in as the account that owns the bound script. This generates an ignored `.clasprc.json` in the project directory, using the pinned clasp v3 format and its default account. This dedicated file avoids copying credentials for other named accounts from an existing global clasp login. Do not use `--use-project-scopes`: deployment needs clasp's upload permissions, not just the running application's scopes.

### 2. Add two GitHub repository secrets

Open [Settings → Secrets and variables → Actions](https://github.com/chollins/tasks-sheet-sync/settings/secrets/actions) and select **New repository secret** for each:

| Name | Value |
| --- | --- |
| `APPS_SCRIPT_ID` | Script ID from Apps Script Project Settings; not the Sheet ID or a URL |
| `CLASP_CREDENTIALS` | Entire contents of the generated `.clasprc.json`, including the outer JSON object |

Open the credential file locally to copy it into the secret form. Do not paste it into chat, commit it, or put it in an Actions variable. The GitHub connection used for this implementation cannot manage repository secrets, so this step requires your account.

Alternatively, if you use the GitHub CLI locally, add the secrets without displaying the credential file:

```sh
gh secret set APPS_SCRIPT_ID --repo chollins/tasks-sheet-sync
gh secret set CLASP_CREDENTIALS --repo chollins/tasks-sheet-sync < .clasprc.json
```

The first command prompts for the Script ID. The second reads the credential JSON directly from the ignored file. A `.clasp.json` is not needed for GitHub deployment; the workflow generates its own configuration.

### 3. Run the deployment

Open [Actions → Deploy to Apps Script](https://github.com/chollins/tasks-sheet-sync/actions/workflows/deploy.yml), choose **Run workflow**, select **main**, and run it. Wait for both `validate` and `deploy` to succeed.

The upload intentionally replaces the dedicated project's source, including its manifest; remote-only code may be removed. Check the Script ID points to the intended bound project before the first run. The workflow does not print the Script ID, credential JSON, or raw clasp output, and uploads no artifacts. It updates source without running setup or task synchronization.

### 4. Finish application authorization once

In the Apps Script editor:

1. Ensure the **Google Tasks API** is enabled for the associated Cloud project. With a default Apps Script Cloud project, add **Tasks API** under **Services → +**; with a standard Cloud project, enable it in Cloud Console.
2. Run `setupTasksSync` and authorize Tasks/Sheets access if not already done.
3. Reload the Sheet, select enabled lists, and perform the [live smoke test](VALIDATION.md) before enabling hourly sync.

Clasp's deployment login and the running application's Google authorization are separate. You do not need to repeat setup after every upload; newly added scopes may require reauthorization.

## Subsequent deployments

Merge/push your code to `main`, then run **Deploy to Apps Script** again. Commits and pull requests run checks but never auto-deploy. Deployments serialize to prevent overlapping pushes.

## If deployment fails

- **Secret validation error:** Check names, use the complete JSON file from clasp v3 login, and ensure its `tokens.default` entry includes a refresh token. No secret contents are echoed by validation.
- **Push failed:** Verify the Script ID, enable the Apps Script API, and check that the authorizing Google account can edit the bound project. If credentials expired or were revoked, rerun the login command and replace `CLASP_CREDENTIALS`.
- **Need more diagnostics:** Recognized failures produce fixed guidance about OAuth, API access, or configuration without echoing private output. For other failures, run local clasp with your local configuration and Google login. CI deliberately suppresses raw clasp output to keep private identifiers out of public workflow logs.
- **Wrong branch:** Deployments only run when dispatched on `main`.

OAuth credentials authorize access beyond just knowing the Script ID. Only trusted repository writers should be able to change code/workflows that receive these secrets. For optional approval gates, create an `apps-script` GitHub environment with a required reviewer (where your plan supports it), add `environment: apps-script` to the `deploy` job, and move both secrets to that environment. The integration could not configure environments, and the default workflow does not require one.
