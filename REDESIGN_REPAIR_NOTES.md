# AI Career Assistant — current repair update

## Implemented in this package
- Added a master-resume upload entry point on Profile; successful selection uploads through the existing resume API and displays a status message.
- Added Resume Maker source controls for saved master, file upload, and profile-derived resume text. Profile data is converted into editable resume text for tailoring.
- Added small workspace style refinements and responsive spacing.
- Retained prior interview and career-chat reliability changes present in the source tree.

## Important behavior and limitations
- AutoApply is an assisted autofill workflow, not autonomous final submission. Its browser automation requires a local Playwright Chromium runtime and is not expected to work on a standard Render web service without a compatible browser setup.
- Profile upload and Resume Maker upload both use the backend upload endpoint; backend/API deployment and CORS must be configured correctly.
- No claims are made that every module is fully functional or production-ready.

## Verification status
- `python -m compileall -q backend/app`: passed.
- `pytest -q`: test collection blocked because the current Python environment lacks `google.oauth2` (`google-auth` dependency); install backend requirements in a clean environment and rerun.
- `npm run build`: not verified; `vite` executable is missing from the frontend dependency installation in this environment. Run `npm ci` in a network-enabled Node environment, then `npm run build`.
- Live Render endpoints, Google OAuth, database persistence, Playwright browser automation, and authenticated end-to-end flows were not tested.
