# Source approval controls design

Use the existing AutoNote consent-page palette: canvas #f6f7f4, ink #17221d, focus #267963, divider #dddddd and error #9d2828. Keep its system sans-serif typography, left-aligned 760px content width and existing button scale. Add one section after connection management, with selected meeting/duration, a separate review and unchecked acknowledgement, then a one-use exchange code. Saved permission metadata and revoke controls follow below. No new navigation, cards or motion.

Review against the brief: this is source permission for reviewing and saving meeting notes, distinct from transcript reading and draft uploading. State that future exact drafts still require AI-side review, that the permission expires, and that no CRM publication is authorized. Show readable meeting/account names alongside exact connection references. Keep long identifiers wrapped and the checkbox adjacent to its label. Source consent is not yet a completed encrypted remote approval workflow.

Issuance pins the current `review_epoch` using required `expectedReviewEpoch`; disabling and re-enabling uploads invalidates an older consent review. This contract is new and remains disabled in production. The browser acceptance uses only disposable GitHub CI fixtures and retains desktop and phone previews.
