/*
 * benchmark.c — measures db_create_entry() throughput directly against
 * db_custom.c, bypassing HTTP so the number reflects only the storage
 * engine's cost (fsync/logging), not network/parsing overhead.
 *
 * Build two ways to compare:
 *   gcc -O2 -o bench_wal   benchmark.c db_custom.c
 *   gcc -O2 -o bench_nowal benchmark.c db_custom.c -DNO_WAL
 *
 * Usage: ./bench_wal [num_writes]   (default 500)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "db.h"

static double now_seconds(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec / 1e9;
}

int main(int argc, char *argv[]) {
    int n = (argc > 1) ? atoi(argv[1]) : 500;

    remove("bench.db");
    remove("bench.db.wal");
    remove("bench.db.checkpoint");

    if (db_init("bench.db") != 0) {
        fprintf(stderr, "db_init failed\n");
        return 1;
    }

    double start = now_seconds();
    for (int i = 0; i < n; i++) {
        JournalEntry e;
        memset(&e, 0, sizeof(e));
        snprintf(e.id, sizeof(e.id), "bench-%d", i);
        snprintf(e.title, sizeof(e.title), "Benchmark entry %d", i);
        snprintf(e.body, sizeof(e.body), "Payload for write throughput test #%d", i);
        snprintf(e.mood, sizeof(e.mood), "calm");
        snprintf(e.created_at, sizeof(e.created_at), "2026-07-19T00:00:00Z");
        snprintf(e.updated_at, sizeof(e.updated_at), "2026-07-19T00:00:00Z");

        if (db_create_entry(&e) != 0) {
            fprintf(stderr, "write %d failed\n", i);
            return 1;
        }
    }
    double elapsed = now_seconds() - start;

    db_close();
    remove("bench.db");
    remove("bench.db.wal");
    remove("bench.db.checkpoint");

    printf("writes=%d elapsed_sec=%.4f writes_per_sec=%.1f\n",
           n, elapsed, (double)n / elapsed);
    return 0;
}
