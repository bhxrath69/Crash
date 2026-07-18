/*
 * db_custom.c — Custom storage engine implementing db.h, with a
 * Write-Ahead Log (WAL), periodic checkpointing, and crash recovery.
 *
 * Files on disk (all in the same directory as the "path" passed to db_init):
 *   <path>            — fixed-slot heap file of JournalEntry records
 *   <path>.wal        — append-only write-ahead log
 *   <path>.checkpoint — last checkpoint's LSN (atomically replaced)
 *
 * Durability design:
 *   - Every create/update/delete first appends a WAL record and fsyncs it,
 *     THEN mutates the data file. If the process dies between those two
 *     steps, the data file may be behind — recovery replays the WAL to
 *     catch it up.
 *   - The data file write itself is NOT fsynced per-operation (that would
 *     defeat the purpose of the WAL); it is fsynced at checkpoint time.
 *   - Checkpoint (every CHECKPOINT_INTERVAL writes): fsync the data file,
 *     record the last-applied LSN, truncate the WAL.
 *   - Recovery (db_init): read last checkpoint LSN, scan the WAL from
 *     there, verify each record's checksum, redo committed records not
 *     yet reflected in the data file, and STOP at the first invalid /
 *     truncated record (a torn write from a mid-append crash).
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdint.h>
#include <stddef.h>
#include "db.h"

#define CHECKPOINT_INTERVAL 50
#define WAL_MAGIC 0x314C4157u /* "WAL1" */

typedef enum { OP_CREATE = 1, OP_UPDATE = 2, OP_DELETE = 3 } OpType;

/* One data-file slot: a used flag followed by the entry itself. */
typedef struct {
    uint8_t used;
    JournalEntry entry;
} Slot;

/* One WAL record. Fixed-size for simplicity — appended as a single
 * fwrite(), so a crash mid-append leaves an incomplete tail record that
 * recovery detects and discards via the checksum. */
typedef struct {
    uint32_t magic;
    uint64_t lsn;
    uint32_t op_type;
    char     entry_id[DB_ID_LEN];
    JournalEntry before_image; /* zeroed for CREATE */
    JournalEntry after_image;  /* zeroed for DELETE  */
    uint32_t checksum;
    uint8_t  committed;
} WalRecord;

/* In-memory index: id -> slot index. Linear array; fine for the scale of
 * a personal journal (thousands of entries). Swap for a hash map or the
 * simpledb B-tree (string-keyed) if this becomes a bottleneck. */
typedef struct {
    char id[DB_ID_LEN];
    long slot_index;
} IndexEntry;

static char g_data_path[600];
static char g_wal_path[600];
static char g_ckpt_path[600];

static int g_data_fd = -1;
static int g_wal_fd  = -1;

static IndexEntry *g_index = NULL;
static long g_index_count = 0;
static long g_index_cap   = 0;

static long g_slot_count = 0;      /* number of slots (used or free) in data file */
static uint64_t g_next_lsn = 1;
static int g_writes_since_checkpoint = 0;
static int g_last_recovery_replay_count = 0;

/* ── checksum ──────────────────────────────────────────────────────────── */

static uint32_t checksum_record(const WalRecord *r) {
    /* Simple additive/rotate checksum over everything except the checksum
     * field itself. Good enough to catch torn/partial writes; swap for
     * CRC32 if you want stronger guarantees. */
    const unsigned char *p = (const unsigned char *)r;
    size_t offset_of_checksum = offsetof(WalRecord, checksum);
    uint32_t sum = 0x811c9dc5u;
    for (size_t i = 0; i < offset_of_checksum; i++) {
        sum ^= p[i];
        sum *= 16777619u;
    }
    return sum;
}

/* ── index helpers ─────────────────────────────────────────────────────── */

static void index_reset(void) {
    free(g_index);
    g_index = NULL;
    g_index_count = 0;
    g_index_cap = 0;
}

static void index_ensure_cap(long needed) {
    if (needed <= g_index_cap) return;
    long new_cap = g_index_cap ? g_index_cap * 2 : 64;
    while (new_cap < needed) new_cap *= 2;
    g_index = realloc(g_index, (size_t)new_cap * sizeof(IndexEntry));
    g_index_cap = new_cap;
}

static long index_find(const char *id) {
    for (long i = 0; i < g_index_count; i++) {
        if (strncmp(g_index[i].id, id, DB_ID_LEN) == 0) return i;
    }
    return -1;
}

static void index_put(const char *id, long slot_index) {
    long existing = index_find(id);
    if (existing >= 0) {
        g_index[existing].slot_index = slot_index;
        return;
    }
    index_ensure_cap(g_index_count + 1);
    strncpy(g_index[g_index_count].id, id, DB_ID_LEN - 1);
    g_index[g_index_count].id[DB_ID_LEN - 1] = '\0';
    g_index[g_index_count].slot_index = slot_index;
    g_index_count++;
}

static void index_remove(const char *id) {
    long existing = index_find(id);
    if (existing < 0) return;
    g_index[existing] = g_index[g_index_count - 1];
    g_index_count--;
}

/* ── data file slot I/O ────────────────────────────────────────────────── */

static int slot_read(long slot_index, Slot *out) {
    off_t off = (off_t)slot_index * (off_t)sizeof(Slot);
    if (lseek(g_data_fd, off, SEEK_SET) < 0) return -1;
    ssize_t n = read(g_data_fd, out, sizeof(Slot));
    return (n == (ssize_t)sizeof(Slot)) ? 0 : -1;
}

static int slot_write(long slot_index, const Slot *in) {
    off_t off = (off_t)slot_index * (off_t)sizeof(Slot);
    if (lseek(g_data_fd, off, SEEK_SET) < 0) return -1;
    ssize_t n = write(g_data_fd, in, sizeof(Slot));
    return (n == (ssize_t)sizeof(Slot)) ? 0 : -1;
}

/* Find a free slot to reuse, or append a new one. */
static long slot_allocate(void) {
    Slot s;
    for (long i = 0; i < g_slot_count; i++) {
        if (slot_read(i, &s) == 0 && !s.used) return i;
    }
    return g_slot_count++;
}

/* ── WAL I/O ───────────────────────────────────────────────────────────── */

static int wal_append(WalRecord *r) {
#ifdef NO_WAL
    /* Benchmark-only mode: skip the log entirely so we can measure the
     * pure fsync/logging overhead the WAL adds. NEVER use this in the
     * real app — there is no durability at all with this defined. */
    (void)r;
    return 0;
#else
    r->checksum = checksum_record(r);
    if (lseek(g_wal_fd, 0, SEEK_END) < 0) return -1;
    ssize_t n = write(g_wal_fd, r, sizeof(*r));
    if (n != (ssize_t)sizeof(*r)) return -1;
    if (fsync(g_wal_fd) == -1) return -1;
    return 0;
#endif
}

/* Apply a (validated, committed) WAL record to the data file + index. */
static void apply_record(const WalRecord *r) {
    switch ((OpType)r->op_type) {
        case OP_CREATE:
        case OP_UPDATE: {
            long idx = index_find(r->entry_id);
            long slot_index = (idx >= 0) ? g_index[idx].slot_index : slot_allocate();
            Slot s;
            s.used = 1;
            s.entry = r->after_image;
            slot_write(slot_index, &s);
            index_put(r->entry_id, slot_index);
            break;
        }
        case OP_DELETE: {
            long idx = index_find(r->entry_id);
            if (idx >= 0) {
                Slot s;
                if (slot_read(g_index[idx].slot_index, &s) == 0) {
                    s.used = 0;
                    slot_write(g_index[idx].slot_index, &s);
                }
                index_remove(r->entry_id);
            }
            break;
        }
    }
}

/* ── checkpoint ────────────────────────────────────────────────────────── */

static int write_checkpoint_file(uint64_t lsn) {
    char tmp_path[620];
    snprintf(tmp_path, sizeof(tmp_path), "%s.tmp", g_ckpt_path);

    int fd = open(tmp_path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) return -1;
    char buf[32];
    int len = snprintf(buf, sizeof(buf), "%llu\n", (unsigned long long)lsn);
    if (write(fd, buf, (size_t)len) != len) { close(fd); return -1; }
    if (fsync(fd) == -1) { close(fd); return -1; }
    close(fd);
    return rename(tmp_path, g_ckpt_path); /* atomic on POSIX */
}

static uint64_t read_checkpoint_file(void) {
    FILE *f = fopen(g_ckpt_path, "r");
    if (!f) return 0;
    unsigned long long lsn = 0;
    if (fscanf(f, "%llu", &lsn) != 1) lsn = 0;
    fclose(f);
    return (uint64_t)lsn;
}

static int do_checkpoint(void) {
    if (fsync(g_data_fd) == -1) return -1;
    if (write_checkpoint_file(g_next_lsn - 1) != 0) return -1;

    /* Truncate the WAL now that everything up to g_next_lsn-1 is durable
     * in the data file. */
    close(g_wal_fd);
    g_wal_fd = open(g_wal_path, O_RDWR | O_CREAT | O_TRUNC, 0600);
    if (g_wal_fd < 0) return -1;
    if (fsync(g_wal_fd) == -1) return -1;

    g_writes_since_checkpoint = 0;
    return 0;
}

/* ── recovery ──────────────────────────────────────────────────────────── */

static void recover(void) {
    uint64_t last_ckpt_lsn = read_checkpoint_file();
    g_last_recovery_replay_count = 0;

    int fd = open(g_wal_path, O_RDONLY);
    if (fd < 0) { g_next_lsn = last_ckpt_lsn + 1; return; }

    uint64_t max_lsn_seen = last_ckpt_lsn;
    WalRecord r;
    while (1) {
        ssize_t n = read(fd, &r, sizeof(r));
        if (n == 0) break;                 /* clean end of log */
        if (n != (ssize_t)sizeof(r)) break; /* torn tail record — stop here */
        if (r.magic != WAL_MAGIC) break;    /* corrupt record — stop here */
        if (checksum_record(&r) != r.checksum) break; /* torn/corrupt — stop */

        if (r.committed && r.lsn > last_ckpt_lsn) {
            apply_record(&r);
            g_last_recovery_replay_count++;
        }
        if (r.lsn > max_lsn_seen) max_lsn_seen = r.lsn;
    }
    close(fd);

    g_next_lsn = max_lsn_seen + 1;

    if (g_last_recovery_replay_count > 0) {
        fsync(g_data_fd);
    }
}

static void rebuild_index_from_data_file(void) {
    index_reset();
    off_t file_size = lseek(g_data_fd, 0, SEEK_END);
    g_slot_count = (file_size < 0) ? 0 : (long)(file_size / (off_t)sizeof(Slot));

    Slot s;
    for (long i = 0; i < g_slot_count; i++) {
        if (slot_read(i, &s) == 0 && s.used) {
            index_put(s.entry.id, i);
        }
    }
}

/* ── public API ────────────────────────────────────────────────────────── */

int db_init(const char *path) {
    snprintf(g_data_path, sizeof(g_data_path), "%s", path);
    snprintf(g_wal_path,  sizeof(g_wal_path),  "%s.wal", path);
    snprintf(g_ckpt_path, sizeof(g_ckpt_path), "%s.checkpoint", path);

    g_data_fd = open(g_data_path, O_RDWR | O_CREAT, 0600);
    if (g_data_fd < 0) return -1;

    g_wal_fd = open(g_wal_path, O_RDWR | O_CREAT, 0600);
    if (g_wal_fd < 0) { close(g_data_fd); g_data_fd = -1; return -1; }

    recover();
    rebuild_index_from_data_file();

    g_writes_since_checkpoint = 0;
    return 0;
}

int db_get_all_entries(JournalEntry **entries_out, int *count_out) {
    *entries_out = NULL;
    *count_out = 0;
    if (g_index_count == 0) return 0;

    JournalEntry *arr = calloc((size_t)g_index_count, sizeof(JournalEntry));
    if (!arr) return -1;

    /* Load all, then sort by created_at DESC (simple insertion sort — index
     * counts are small for a personal journal). */
    Slot s;
    long n = 0;
    for (long i = 0; i < g_index_count; i++) {
        if (slot_read(g_index[i].slot_index, &s) == 0 && s.used) {
            arr[n++] = s.entry;
        }
    }

    for (long i = 1; i < n; i++) {
        JournalEntry key = arr[i];
        long j = i - 1;
        while (j >= 0 && strcmp(arr[j].created_at, key.created_at) < 0) {
            arr[j + 1] = arr[j];
            j--;
        }
        arr[j + 1] = key;
    }

    *entries_out = arr;
    *count_out = (int)n;
    return 0;
}

static int write_entry_op(OpType op, const JournalEntry *entry, const JournalEntry *before) {
    WalRecord r;
    memset(&r, 0, sizeof(r));
    r.magic = WAL_MAGIC;
    r.lsn = g_next_lsn++;
    r.op_type = (uint32_t)op;
    strncpy(r.entry_id, entry->id, DB_ID_LEN - 1);
    if (before) r.before_image = *before;
    if (op != OP_DELETE) r.after_image = *entry;
    r.committed = 1;

    if (wal_append(&r) != 0) return -1;
    apply_record(&r);

    if (++g_writes_since_checkpoint >= CHECKPOINT_INTERVAL) {
        do_checkpoint();
    }
    return 0;
}

int db_create_entry(const JournalEntry *entry) {
    return write_entry_op(OP_CREATE, entry, NULL);
}

int db_update_entry(const JournalEntry *entry) {
    long idx = index_find(entry->id);
    JournalEntry before;
    memset(&before, 0, sizeof(before));
    if (idx >= 0) {
        Slot s;
        if (slot_read(g_index[idx].slot_index, &s) == 0) before = s.entry;
    }
    return write_entry_op(OP_UPDATE, entry, &before);
}

int db_delete_entry(const char *id) {
    long idx = index_find(id);
    if (idx < 0) return -1;

    Slot s;
    JournalEntry before;
    memset(&before, 0, sizeof(before));
    if (slot_read(g_index[idx].slot_index, &s) == 0) before = s.entry;

    JournalEntry stub;
    memset(&stub, 0, sizeof(stub));
    strncpy(stub.id, id, DB_ID_LEN - 1);

    return write_entry_op(OP_DELETE, &stub, &before);
}

void db_free_entries(JournalEntry *entries, int count) {
    (void)count;
    free(entries);
}

void db_close(void) {
    if (g_data_fd >= 0) { do_checkpoint(); close(g_data_fd); g_data_fd = -1; }
    if (g_wal_fd  >= 0) { close(g_wal_fd);  g_wal_fd = -1; }
    index_reset();
}

int db_last_recovery_replay_count(void) {
    return g_last_recovery_replay_count;
}
