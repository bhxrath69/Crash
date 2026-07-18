/*
 * db_sqlite.c — SQLite3 implementation of the db.h interface.
 *
 * Swap this file for your own custom C database implementation by providing
 * the same six functions declared in db.h.
 *
 * Compile with: -lsqlite3
 */

#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <sqlite3.h>
#include "db.h"

static sqlite3 *g_db = NULL;

static const char *SCHEMA =
    "CREATE TABLE IF NOT EXISTS entries ("
    "  id         TEXT PRIMARY KEY,"
    "  title      TEXT NOT NULL DEFAULT '',"
    "  body       TEXT NOT NULL DEFAULT '',"
    "  mood       TEXT NOT NULL DEFAULT 'wild',"
    "  created_at TEXT NOT NULL,"
    "  updated_at TEXT NOT NULL"
    ");";

int db_init(const char *path) {
    if (sqlite3_open(path, &g_db) != SQLITE_OK) {
        fprintf(stderr, "db_init: cannot open '%s': %s\n", path, sqlite3_errmsg(g_db));
        return -1;
    }
    sqlite3_exec(g_db, "PRAGMA journal_mode=WAL;", NULL, NULL, NULL);
    char *err = NULL;
    if (sqlite3_exec(g_db, SCHEMA, NULL, NULL, &err) != SQLITE_OK) {
        fprintf(stderr, "db_init: schema error: %s\n", err);
        sqlite3_free(err);
        return -1;
    }
    return 0;
}

int db_get_all_entries(JournalEntry **entries_out, int *count_out) {
    *entries_out = NULL;
    *count_out   = 0;

    sqlite3_stmt *stmt = NULL;
    const char *sql = "SELECT id, title, body, mood, created_at, updated_at "
                      "FROM entries ORDER BY created_at DESC;";

    if (sqlite3_prepare_v2(g_db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        fprintf(stderr, "db_get_all_entries: prepare: %s\n", sqlite3_errmsg(g_db));
        return -1;
    }

    /* First pass: count rows */
    int count = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW) count++;
    sqlite3_reset(stmt);

    if (count == 0) {
        sqlite3_finalize(stmt);
        return 0;
    }

    JournalEntry *arr = calloc(count, sizeof(JournalEntry));
    if (!arr) { sqlite3_finalize(stmt); return -1; }

    int i = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW && i < count) {
        JournalEntry *e = &arr[i++];

        const char *col;
#define COPY(field, idx) \
        col = (const char *)sqlite3_column_text(stmt, idx); \
        if (col) strncpy(e->field, col, sizeof(e->field) - 1)

        COPY(id,         0);
        COPY(title,      1);
        COPY(body,       2);
        COPY(mood,       3);
        COPY(created_at, 4);
        COPY(updated_at, 5);
#undef COPY
    }

    sqlite3_finalize(stmt);
    *entries_out = arr;
    *count_out   = i;
    return 0;
}

int db_create_entry(const JournalEntry *e) {
    const char *sql =
        "INSERT INTO entries (id, title, body, mood, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?);";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(g_db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        fprintf(stderr, "db_create_entry: prepare: %s\n", sqlite3_errmsg(g_db));
        return -1;
    }

    sqlite3_bind_text(stmt, 1, e->id,         -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 2, e->title,       -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 3, e->body,        -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 4, e->mood,        -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 5, e->created_at,  -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 6, e->updated_at,  -1, SQLITE_STATIC);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        fprintf(stderr, "db_create_entry: step: %s\n", sqlite3_errmsg(g_db));
        return -1;
    }
    return 0;
}

int db_delete_entry(const char *id) {
    const char *sql = "DELETE FROM entries WHERE id = ?;";
    sqlite3_stmt *stmt = NULL;

    if (sqlite3_prepare_v2(g_db, sql, -1, &stmt, NULL) != SQLITE_OK) return -1;
    sqlite3_bind_text(stmt, 1, id, -1, SQLITE_STATIC);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return (rc == SQLITE_DONE) ? 0 : -1;
}

void db_free_entries(JournalEntry *entries, int count) {
    (void)count;
    free(entries);
}

void db_close(void) {
    if (g_db) {
        sqlite3_close(g_db);
        g_db = NULL;
    }
}
