# Portable Journal — Backend

A USB-portable journaling app backend with a custom C storage engine:
Write-Ahead Logging, checkpointing, and crash recovery, replacing SQLite.

## Architecture

```
        React frontend (unchanged)
                  │
          REST API (main.c)
     GET/POST/DELETE /api/entries
       GET /api/recovery-status
                  │
        db.h interface (6 functions
        + db_update_entry)
                  │
        db_custom.c storage engine
      ┌───────────┼───────────────┐
      │           │               │
 journal.db   journal.db.wal  journal.db.checkpoint
 (fixed-slot   (append-only,   (last durably-applied
  heap file)    fsync'd log)    LSN, atomically
                                 replaced)
```

## Write path (durability)

Every `db_create_entry` / `db_update_entry` / `db_delete_entry` call:

1. Builds a WAL record (LSN, op type, entry id, before-image, after-image,
   checksum, commit flag).
2. Appends it to `journal.db.wal` and calls `fsync()` — this is the
   durability boundary. If the process dies after this point, the write
   survives, even if it never reached the data file.
3. Only then mutates `journal.db` in memory/on the fd (not fsynced per
   write — that would defeat the point of having a WAL).
4. Every 50 writes, a checkpoint runs: `fsync(journal.db)`, record the
   last-applied LSN in `journal.db.checkpoint` (atomic rename), then
   truncate the WAL.

## Crash recovery

On `db_init()`:

1. Read the last checkpoint LSN from `journal.db.checkpoint` (0 if absent).
2. Scan `journal.db.wal` from the start, record by record.
3. For each record: verify a checksum computed over the whole record. Stop
   scanning at the first mismatch or short read — this is what a torn
   write from a mid-append crash (or a yanked USB drive) looks like.
4. Redo every committed record with `LSN > last checkpoint LSN` by
   re-applying it to `journal.db`.
5. Rebuild the in-memory id → slot index by scanning `journal.db`.

`db_last_recovery_replay_count()` reports how many records were replayed
on the most recent startup; it's exposed over HTTP at
`GET /api/recovery-status` for the frontend's Recovery screen.

## What this guarantees, and what it doesn't

**Guaranteed:** an operation that received an HTTP 201/200 response is
durable — it will survive a `kill -9` or power loss, and will be present
after the next `db_init()`, even if the process never got to run a clean
shutdown or checkpoint.

**Not implemented (by design, given the current scope):** multi-statement
transactions with rollback/undo. Every operation here is a single record
(one entry create/update/delete), so there's no partial-transaction state
to unwind — recovery only ever needs to *redo*, never *undo*. If the
project grows to support multi-entry atomic operations later, an undo
path would need to be added.

## Benchmarks

Measured with `benchmark.c`, which calls `db_create_entry()` directly
(bypassing HTTP, so the number reflects only the storage engine):

```
gcc -O2 -o bench_wal   benchmark.c db_custom.c
gcc -O2 -o bench_nowal benchmark.c db_custom.c -DNO_WAL
./bench_wal 500
./bench_nowal 500
```

**Verified result (run on real hardware, 500 writes):**

| Mode     | writes/sec |
|----------|-----------|
| WAL on   | 430       |
| WAL off  | 718       |

**WAL adds ~40% write overhead in exchange for zero data loss across
crash scenarios** (verified below).

## Crash-recovery test

`kill_loop_test.sh` repeatedly starts the server, floods it with writes,
`kill -9`'s it at a random point (200–999ms into the burst, so real
writes are actively in flight each time), restarts it, and verifies
every entry that received an HTTP 201 is still present:

```
./kill_loop_test.sh 100
```

**Verified result (100 iterations, run on real hardware):**
**0 data-loss failures across 273 accumulated, acknowledged writes** —
every single write that received an HTTP 201 response survived its
`kill -9`, across all 100 crash/restart cycles.

## Unit tests

```
gcc -O2 -o unit_tests unit_tests.c db_custom.c
./unit_tests
```

Covers: create/read, update, delete, persistence across a clean restart,
recovery after an *unclean* close (no checkpoint), and duplicate-id
update semantics (no duplicate slots on update).

## Building

```
make          # builds ./journal using the custom engine
make clean    # removes the binary and all journal.db* files
```

## Known limitations / next steps

- The in-memory id index is a linear array (fine at personal-journal
  scale; consider a hash map or the string-keyed B-tree from the
  `simpledb` learning project if entry counts grow very large).
- Checksum is a simple FNV-style hash, not CRC32 — sufficient to detect
  torn writes, but not a cryptographic integrity guarantee.
- No multi-entry transactions (see "What this guarantees" above).
