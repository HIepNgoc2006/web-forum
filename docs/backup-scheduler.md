# Backup Scheduler

Use the backup scheduler tooling to create timestamped backups of the configured forum state and recoverable upload data.

The scheduler is disabled by default and all backup commands dry-run by default. A write backup requires `--write`; recurring schedule mode also requires `--enable` or `BACKUP_SCHEDULER_ENABLED=true`.

## One-Off Dry Run

```bash
npm run backup:run -- --store-driver json --driver local
```

The dry run reads the configured store and upload storage, reports source/destination/system metadata, and does not write backup files.

## One-Off Write

```bash
npm run backup:run -- --store-driver json --driver local --destination backend/data/backups --write --operator release
```

Mongo-backed state:

```bash
STORE_DRIVER=mongo MONGODB_URI=mongodb://... npm run backup:run -- --store-driver mongo --db staging --driver s3 --destination backend/data/backups --write --operator scheduler
```

For S3, this repository writes an object manifest but does not copy bucket bytes. A write backup fails unless provider versioning or a separate bucket export is explicitly confirmed:

```bash
npm run backup:run -- --driver s3 --write --s3-backup-confirmed
```

The equivalent environment setting is `S3_BACKUP_CONFIRMED=true`.

S3-compatible upload metadata uses the existing upload environment variables:

```env
IMAGE_STORAGE_DRIVER=s3
S3_ENDPOINT=...
S3_REGION=...
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_KEY_PREFIX=uploads
```

Each write backup creates:

- `<timestamp>-forum-state.json`: normalized full forum state from the configured store.
- `<timestamp>-uploads/`: copied local upload bytes, preserving storage-key paths.
- `<timestamp>-uploads-manifest.json`: upload keys, copied-file SHA-256 checksums, sizes, and recoverability status.
- `<timestamp>-backup-metadata.json`: timestamp, source, destination, operator, host, process id, counts, and failure details.

## Scheduled Mode

```bash
BACKUP_SCHEDULER_ENABLED=true BACKUP_INTERVAL_MS=86400000 npm run backup:schedule -- --write --destination backend/data/backups
```

Or pass `--enable` explicitly:

```bash
npm run backup:schedule -- --enable --write --interval-ms 86400000 --destination backend/data/backups
```

The scheduler prevents overlapping backup jobs. In development, keep it disabled unless testing the scheduler directly.

## Failure Handling

Read, copy, manifest, metadata, or state-write failures make the command exit nonzero. The job still attempts to write backup metadata, and the thrown error includes the structured result. S3 write jobs also fail when provider-side byte backup has not been confirmed.

Verify backup health by running:

```bash
npm run backup:run -- --dry-run
npm test
```
