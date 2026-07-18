/*
 * unit_tests.c — basic correctness tests for db_custom.c.
 * No test framework dependency — plain asserts, exits non-zero on failure.
 *
 * Build: gcc -O2 -o unit_tests unit_tests.c db_custom.c
 * Run:   ./unit_tests
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <unistd.h>
#include "db.h"

static void wipe(void) {
    remove("test.db");
    remove("test.db.wal");
    remove("test.db.checkpoint");
}

static JournalEntry make_entry(const char *id, const char *title) {
    JournalEntry e;
    memset(&e, 0, sizeof(e));
    snprintf(e.id, sizeof(e.id), "%s", id);
    snprintf(e.title, sizeof(e.title), "%s", title);
    snprintf(e.body, sizeof(e.body), "body for %s", id);
    snprintf(e.mood, sizeof(e.mood), "calm");
    snprintf(e.created_at, sizeof(e.created_at), "2026-07-19T00:00:0%sZ", id + 5);
    snprintf(e.updated_at, sizeof(e.updated_at), "2026-07-19T00:00:0%sZ", id + 5);
    return e;
}

static void test_create_and_read(void) {
    printf("test_create_and_read... ");
    wipe();
    assert(db_init("test.db") == 0);

    JournalEntry e1 = make_entry("id-1", "First");
    JournalEntry e2 = make_entry("id-2", "Second");
    assert(db_create_entry(&e1) == 0);
    assert(db_create_entry(&e2) == 0);

    JournalEntry *out = NULL;
    int count = 0;
    assert(db_get_all_entries(&out, &count) == 0);
    assert(count == 2);
    db_free_entries(out, count);

    db_close();
    printf("OK\n");
}

static void test_update(void) {
    printf("test_update... ");
    wipe();
    assert(db_init("test.db") == 0);

    JournalEntry e = make_entry("id-1", "Original");
    assert(db_create_entry(&e) == 0);

    JournalEntry updated = e;
    snprintf(updated.title, sizeof(updated.title), "Updated title");
    assert(db_update_entry(&updated) == 0);

    JournalEntry *out = NULL;
    int count = 0;
    assert(db_get_all_entries(&out, &count) == 0);
    assert(count == 1);
    assert(strcmp(out[0].title, "Updated title") == 0);
    db_free_entries(out, count);

    db_close();
    printf("OK\n");
}

static void test_delete(void) {
    printf("test_delete... ");
    wipe();
    assert(db_init("test.db") == 0);

    JournalEntry e1 = make_entry("id-1", "Keep");
    JournalEntry e2 = make_entry("id-2", "Remove");
    assert(db_create_entry(&e1) == 0);
    assert(db_create_entry(&e2) == 0);
    assert(db_delete_entry("id-2") == 0);

    JournalEntry *out = NULL;
    int count = 0;
    assert(db_get_all_entries(&out, &count) == 0);
    assert(count == 1);
    assert(strcmp(out[0].id, "id-1") == 0);
    db_free_entries(out, count);

    db_close();
    printf("OK\n");
}

static void test_persistence_across_restart(void) {
    printf("test_persistence_across_restart... ");
    wipe();
    assert(db_init("test.db") == 0);
    JournalEntry e = make_entry("id-1", "Survives restart");
    assert(db_create_entry(&e) == 0);
    db_close();

    /* Simulate a fresh process: re-init and confirm data is still there. */
    assert(db_init("test.db") == 0);
    JournalEntry *out = NULL;
    int count = 0;
    assert(db_get_all_entries(&out, &count) == 0);
    assert(count == 1);
    assert(strcmp(out[0].title, "Survives restart") == 0);
    db_free_entries(out, count);
    db_close();
    printf("OK\n");
}

static void test_recovery_replays_wal_after_unclean_close(void) {
    printf("test_recovery_replays_wal_after_unclean_close... ");
    wipe();
    assert(db_init("test.db") == 0);
    JournalEntry e = make_entry("id-1", "Not cleanly closed");
    assert(db_create_entry(&e) == 0);
    /* Deliberately skip db_close() — simulates a crash: no checkpoint,
     * data file may not be fsynced, only the WAL is guaranteed durable. */

    assert(db_init("test.db") == 0);
    JournalEntry *out = NULL;
    int count = 0;
    assert(db_get_all_entries(&out, &count) == 0);
    assert(count == 1);
    assert(strcmp(out[0].title, "Not cleanly closed") == 0);
    db_free_entries(out, count);
    db_close();
    printf("OK\n");
}

static void test_duplicate_ids_overwrite_via_update_semantics(void) {
    printf("test_duplicate_create_then_update... ");
    wipe();
    assert(db_init("test.db") == 0);
    JournalEntry e = make_entry("id-1", "v1");
    assert(db_create_entry(&e) == 0);

    JournalEntry e2 = make_entry("id-1", "v2");
    assert(db_update_entry(&e2) == 0);

    JournalEntry *out = NULL;
    int count = 0;
    assert(db_get_all_entries(&out, &count) == 0);
    assert(count == 1); /* must not create a duplicate slot */
    assert(strcmp(out[0].title, "v2") == 0);
    db_free_entries(out, count);
    db_close();
    printf("OK\n");
}

int main(void) {
    test_create_and_read();
    test_update();
    test_delete();
    test_persistence_across_restart();
    test_recovery_replays_wal_after_unclean_close();
    test_duplicate_ids_overwrite_via_update_semantics();
    wipe();
    printf("\nAll unit tests passed.\n");
    return 0;
}
