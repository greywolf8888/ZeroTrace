# Submission draft — not submitted

ZeroTrace's Arc USDC Settlement Verifier is a read-only, evidence-linked application for checking explicit receiving conditions against a newly queried mainnet transaction or a supported ArcBounty task.

The implementation normalizes Arc native and ERC-20 balance interfaces into canonical USDC movements without mirror double-counting, preserves integer precision, separates Gas and net movements, and distinguishes matched, mismatched and inconclusive results. Fixed reports retain raw observations and frozen conditions. Users can export a bundle, recompute it offline, explicitly query the chain again, and use a separate TypeScript/SQLite accounting example.

Validation evidence must be taken from the current release's VALIDATION.json, source commit and deployment receipt. Local browser, database and mainnet tests are separate from public deployment acceptance. Synthetic counterexamples are labeled. Offline integrity does not prove mainnet authenticity, user intent, order ownership or fulfillment.

No signing, token approvals, broadcasting, automatic fund movement or automatic delivery is implemented. There are no claims of external adoption, award probability, human approval or complete forensic coverage. Grant eligibility, applicant identity, budget request and any submission decision remain with the owner. This draft has not been sent or submitted.
