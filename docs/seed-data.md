# Demo and Staging Seed Data

Use the seed tooling to export sanitized board/thread/comment data from a known-good environment and import it into demo or staging.

The seed format intentionally excludes users, account-private data, reports, sanctions, moderation actions, AI usage/cache data, raw IPs, poster tokens, captcha/admin tokens, delete-password hashes, author fingerprints, poll voter maps, and inline media data URLs. Referenced media metadata such as `storageKey`, `url`, dimensions, and thumbnail metadata can remain in the seed, so make sure the referenced uploads exist in the target storage.

## Export

```bash
npm run seed:export -- --store-driver json --out seeds/demo.json
```

For Mongo-backed staging:

```bash
STORE_DRIVER=mongo MONGODB_URI=mongodb://... npm run seed:export -- --store-driver mongo --db staging --out seeds/staging.json
```

Add `--public-boards-only` when hidden boards should be excluded.

## Import Dry Run

Imports are dry-run by default:

```bash
npm run seed:import -- --store-driver json --in seeds/demo.json
```

The dry run validates the seed schema and reports how many boards, threads, and comments would be added, skipped, or replaced.

## Import Write

Use `--write` to apply a seed:

```bash
npm run seed:import -- --store-driver json --in seeds/demo.json --write
```

Duplicate boards and posts are skipped by default. Use `--replace` only when you intend matching board slugs, post IDs, or global post numbers to be replaced:

```bash
npm run seed:import -- --store-driver json --in seeds/demo.json --write --replace
```

## Rollback

Every write import creates a rollback JSON snapshot before writing. Pass an explicit path when running in CI or staging:

```bash
npm run seed:import -- --store-driver json --in seeds/demo.json --write --rollback data/rollback-before-demo-seed.json
```

If the write fails, the tool attempts to restore the previous state through the same store interface and reports the rollback snapshot path on the thrown error.

To rollback after a successful import, restore the rollback snapshot:

```bash
npm run seed:restore -- --store-driver json --in data/rollback-before-demo-seed.json --write
```

`restore` writes the full forum state snapshot, including users, reports, sanctions, moderation actions, and other non-seed data that normal seed import/export intentionally excludes. Like import, restore is dry-run by default unless `--write` is present.

Always verify the target after import:

```bash
npm test
npm run test:e2e
```
