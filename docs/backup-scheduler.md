# Backup Scheduler

Use the backup scheduler tooling to create timestamped backups of the configured forum state plus upload-storage metadata.

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
- `<timestamp>-uploads-manifest.json`: upload keys and local file metadata when available.
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

Read/list failures make the command fail. Write failures are recorded in backup metadata and in the command output. Treat any non-empty `failures` array as an operational alert.

Verify backup health by running:

```bash
npm run backup:run -- --dry-run
npm test
```
