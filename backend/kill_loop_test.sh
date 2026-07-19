#!/bin/bash
# kill_loop_test.sh — repeatedly kill -9 the journal server mid-write and
# verify every entry that received an HTTP 201 (i.e. was actually
# acknowledged as committed) survives the crash and restart.
#
# Usage: ./kill_loop_test.sh [iterations] [port]

set -u
ITER=${1:-50}
PORT=${2:-8099}
BASE="http://localhost:${PORT}"
DB_PREFIX="journal.db"
CONFIRMED_IDS_FILE="/tmp/kill_loop_confirmed_ids.txt"
FAILURES=0

cleanup_db() {
    rm -f "${DB_PREFIX}" "${DB_PREFIX}.wal" "${DB_PREFIX}.checkpoint"
}

start_server() {
    ./journal "${PORT}" > /tmp/kill_loop_server.log 2>&1 &
    echo $!
}

wait_for_server() {
    for _ in $(seq 1 50); do
        if curl -s -o /dev/null "${BASE}/api/health"; then return 0; fi
        sleep 0.05
    done
    return 1
}

# Flood the server with creates as fast as possible in the background.
# Every entry whose curl call returns HTTP 201 gets its id appended to
# CONFIRMED_IDS_FILE — those are the ones that MUST survive a crash.
flood_creates() {
    local i=0
    while true; do
        i=$((i+1))
        resp=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/entries" \
               -d "{\"title\":\"loadtest-${i}\",\"body\":\"kill-loop payload ${i}\",\"mood\":\"calm\"}" \
               2>/dev/null)
        code=$(echo "$resp" | tail -n1)
        body=$(echo "$resp" | sed '$d')
        if [ "$code" = "201" ]; then
            id=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
            if [ -n "$id" ]; then echo "$id" >> "${CONFIRMED_IDS_FILE}"; fi
        fi
    done
}

echo "=== Kill-loop crash recovery test: ${ITER} iterations ==="
cleanup_db
rm -f "${CONFIRMED_IDS_FILE}"
touch "${CONFIRMED_IDS_FILE}"

for run in $(seq 1 "${ITER}"); do
    PID=$(start_server)
    if ! wait_for_server; then
        echo "[run ${run}] FAIL: server never came up"
        FAILURES=$((FAILURES+1))
        kill -9 "${PID}" 2>/dev/null
        continue
    fi

    flood_creates &
    FLOOD_PID=$!

    # Random short delay before killing — puts the kill at an
    # unpredictable point relative to WAL/data writes.
    MS=$(( (RANDOM % 800) + 200 ))
    sleep "0.$(printf '%03d' "$MS")"

    kill -9 "${PID}" 2>/dev/null
    kill -9 "${FLOOD_PID}" 2>/dev/null
    wait "${PID}" 2>/dev/null
    wait "${FLOOD_PID}" 2>/dev/null

    # Restart and verify every confirmed id is still present.
    PID2=$(start_server)
    if ! wait_for_server; then
        echo "[run ${run}] FAIL: server would not restart after crash"
        FAILURES=$((FAILURES+1))
        kill -9 "${PID2}" 2>/dev/null
        continue
    fi

    all_entries=$(curl -s "${BASE}/api/entries")
    missing=0
    while read -r cid; do
        [ -z "$cid" ] && continue
        echo "$all_entries" | grep -q "\"$cid\"" || missing=$((missing+1))
    done < "${CONFIRMED_IDS_FILE}"

    if [ "$missing" -gt 0 ]; then
        echo "[run ${run}] FAIL: ${missing} confirmed entries missing after crash+recovery"
        FAILURES=$((FAILURES+1))
    else
        confirmed_count=$(wc -l < "${CONFIRMED_IDS_FILE}")
        echo "[run ${run}] OK: ${confirmed_count} confirmed entries all present"
    fi

    kill -9 "${PID2}" 2>/dev/null
    wait "${PID2}" 2>/dev/null
done

echo "=== Done: ${FAILURES} failures out of ${ITER} runs ==="
cleanup_db
rm -f "${CONFIRMED_IDS_FILE}"
