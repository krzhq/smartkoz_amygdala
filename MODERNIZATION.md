# SmartKóz 2.0 implementation plan

The existing application is Express 5, better-sqlite3, buildless vanilla JavaScript/CSS, Python/Ultralytics video analysis and PDFKit reports. The original database contains seeded workers, sensors and transport; the dashboard also returns fixed metrics. Existing model weights and source videos are retained.

1. Back up SQLite, explicitly reset legacy demo data once, and remove recurring seed/sync code. Keep existing tables and APIs; add relational operational tables and indexes.
2. Add ADMIN/EMPLOYEE authorization, employee registration, private uploads, protected sessions and scoped SSE updates with database reload on reconnect.
3. Add photo-based PPE analysis using outfitcheck.pt, honest unavailable results, audited administrator approval, and transactional shift start/end.
4. Add immutable evacuation membership, idempotent safety reports, persisted deadlines, periodic recovery after restart, search cases and audited closure.
5. Add uploaded facility plans, polygon zones, witness reports, video analysis jobs and human review. Detections indicate people, never prove identity or safety.
6. Extend the current frontend with a responsive top navigation and separate employee workspace. Retain existing monitoring/report/task functions in the same app; label bundled recordings as demonstration sources.
7. Run isolated database integration tests, JavaScript validation and available browser checks. Document architecture, APIs, launch, two-device demo and verification limits.

No hosted deployment: the requested workspace application relies on local SQLite, model weights and Python processes.
