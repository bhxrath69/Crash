#ifndef JOURNAL_DB_H
#define JOURNAL_DB_H
/* Maximum field sizes — adjust to match your custom database's constraints */
#define DB_ID_LEN       64
#define DB_TITLE_LEN    512
#define DB_BODY_LEN     16384
#define DB_MOOD_LEN     32
#define DB_DATETIME_LEN 32
typedef struct {
    char id[DB_ID_LEN];
    char title[DB_TITLE_LEN];
    char body[DB_BODY_LEN];
    char mood[DB_MOOD_LEN];
    char created_at[DB_DATETIME_LEN];
    char updated_at[DB_DATETIME_LEN];
} JournalEntry;
/*
 * Implement these functions against your custom C database.
 * A reference SQLite implementation is provided in db_sqlite.c.
 *
 * All functions return 0 on success, non-zero on error.
 */
/* Open/create the database at the given file path. Call once at startup. */
int  db_init(const char *path);
/*
 * Load all entries ordered by created_at DESC into a heap-allocated array.
 * The caller must free the result with db_free_entries().
 */
int  db_get_all_entries(JournalEntry **entries_out, int *count_out);
/* Insert a new entry. entry->id, entry->created_at, entry->updated_at are
 * expected to be pre-filled by the caller. */
int  db_create_entry(const JournalEntry *entry);
/* Update an existing entry (matched by entry->id) in place. */
int  db_update_entry(const JournalEntry *entry);
/* Hard-delete the entry with the given id. */
int  db_delete_entry(const char *id);
/* Free the array returned by db_get_all_entries. */
void db_free_entries(JournalEntry *entries, int count);
/* Flush and close the database. Call on shutdown. */
void db_close(void);
/* Number of WAL records redone during the most recent db_init() recovery. */
int  db_last_recovery_replay_count(void);
#endif /* JOURNAL_DB_H */
