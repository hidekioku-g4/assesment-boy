# Template reference (for editing)

This folder contains the current draft template sources, copied from the live config/prompt
so you can edit safely.

- support-record.json: copied from `config/support-record.json`
- support-record-draft.js: copied from `server/prompts/support-record-draft.js`

If you want to apply changes back:
1) Edit the files in this folder.
2) Copy them back to the original paths above.

Tip (PowerShell):
- `Copy-Item docs\template\support-record.json config\support-record.json -Force`
- `Copy-Item docs\template\support-record-draft.js server\prompts\support-record-draft.js -Force`
