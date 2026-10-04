# Project memory

Working notes for the DigiLite Hub rebuild: decisions, findings and context that aren't obvious from the code. Each file holds one topic and has a short frontmatter header. Keep them current: update a file when something changes, and delete anything that turns out to be wrong.

- [Project overview](project-overview.md): what DigiLite is, what's in this repo, and the rebuild plan
- [Domain model](domain-model.md): the bag is the asset; riders are contractors on dated assignments
- [Product priorities](product-priorities.md): what the dashboard must do first, and what can wait
- [Design direction](design-direction.md): the chosen look, type and layout principles, and the design canvas
- [Colorlight Cloud API](colorlight-api.md): official docs, auth, the endpoints we use, and caveats
- [Live fleet findings](fleet-findings.md): what the real fleet data showed on 2026-09-29
- [Prototype audit](prototype-audit.md): what in `simple-app/` is worth keeping, and what's broken
- [Original spec analysis](spec-analysis.md): the V1 spec against current plans, plus longer-term direction
- [Architecture notes](architecture-notes.md): map rendering at scale, data flow from Colorlight, pre-aggregation
- [Open questions](open-questions.md): unresolved items to check or decide
