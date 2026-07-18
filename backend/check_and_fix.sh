#!/bin/bash
# check_and_fix.sh — one-shot diagnostic for the Portable Journal backend.
# Run this from the folder containing main.c, db_custom.c, db.h, Makefile.
#
# It will, in order:
#   1. Kill any stale `journal` process and free the port
#   2. Clean-rebuild the binary and show any compile errors clearly
#   3. Run the server standalone for 1s to catch an immediate crash
#   4. Smoke-test create / get / delete over real HTTP
#   5. Run a short (10-iteration) kill -9 crash-recovery test
#   6. Print a clear PASS/FAIL summary with next-step suggestions
#
# Usage: ./check_and_fix.sh [port]

set -u
PORT=${1:-8099}
BASE="http://localhost:${PORT}"
STEP_FAILED=0

pass() { echo "  [PASS] $1"; }
fail() { echo "  [FAIL] $1"; STEP_FAILED=1; }

echo "=================================================="
echo " Portable Journal — full diagnostic"
echo "=================================================="

# ── Step 0: required tools present? ─────────────────────────────────────
echo
echo "--- Step 0: checking required tools ---"
for tool in gcc curl python3; do
    if command -v "$tool" >/dev/null 2>&1; then
        pass "$tool found"
    else
        fail "$tool NOT found — install it before continuing (e.g. sudo apt install $tool)"
    fi
done

PORT_CHECK_TOOL=""
if command -v lsof >/dev/null 2>&1; then
    PORT_CHECK_TOOL="lsof"
elif command -v fuser >/dev/null 2>&1; then
    PORT_CHECK_TOOL="fuser"
else
    echo "  [WARN] neither lsof nor fuser found — will skip stale-process detection"
    echo "         (install one with: sudo apt install lsof)"
fi

# ── Step 1: check for stale processes / port conflicts ──────────────────
echo
echo "--- Step 1: checking for stale processes on port ${PORT} ---"
STALE_PIDS=""
if [ "$PORT_CHECK_TOOL" = "lsof" ]; then
    STALE_PIDS=$(lsof -ti tcp:"${PORT}" 2>/dev/null)
elif [ "$PORT_CHECK_TOOL" = "fuser" ]; then
    STALE_PIDS=$(fuser "${PORT}"/tcp 2>/dev/null)
fi
if [ -n "$STALE_PIDS" ]; then
    echo "  Found process(es) already using port ${PORT}: ${STALE_PIDS}"
    echo "  Killing them..."
    kill -9 $STALE_PIDS 2>/dev/null
    sleep 0.5
    pass "port ${PORT} cleared"
elif [ -z "$PORT_CHECK_TOOL" ]; then
    echo "  (skipped — no lsof/fuser available)"
else
    pass "port ${PORT} was free"
fi
pkill -9 -f "\./journal" 2>/dev/null
sleep 0.3

# ── Step 2: required source files present? ──────────────────────────────
echo
echo "--- Step 2: checking required files are in this directory ---"
for f in main.c db_custom.c db.h Makefile; do
    if [ -f "$f" ]; then
        pass "$f present"
    else
        fail "$f MISSING — you're probably in the wrong directory (run: pwd)"
    fi
done
if [ "$STEP_FAILED" -eq 1 ]; then
    echo
    echo "Stopping here — fix the missing files/tools above and rerun."
    exit 1
fi

# ── Step 3: clean rebuild ────────────────────────────────────────────────
echo
echo "--- Step 3: clean rebuild ---"
make clean >/dev/null 2>&1
BUILD_LOG=$(make 2>&1)
if [ -x "./journal" ]; then
    pass "build succeeded"
else
    fail "build FAILED — full compiler output below:"
    echo "----------------------------------------"
    echo "$BUILD_LOG"
    echo "----------------------------------------"
    echo "Paste the block above back to Claude to get the exact fix."
    exit 1
fi

# ── Step 4: wipe old db files so we start clean ─────────────────────────
echo
echo "--- Step 4: removing old database files (fresh start) ---"
rm -f journal.db journal.db.wal journal.db.checkpoint
pass "old journal.db* files removed"

# ── Step 5: does it even start? ─────────────────────────────────────────
echo
echo "--- Step 5: starting server standalone (checking for immediate crash) ---"
./journal "${PORT}" > /tmp/journal_check.log 2>&1 &
SRV_PID=$!
sleep 1
if kill -0 "$SRV_PID" 2>/dev/null; then
    pass "server is running (pid ${SRV_PID})"
else
    fail "server exited immediately — log below:"
    echo "----------------------------------------"
    cat /tmp/journal_check.log
    echo "----------------------------------------"
    echo "Paste the block above back to Claude to get the exact fix."
    exit 1
fi

# ── Step 6: HTTP smoke test ─────────────────────────────────────────────
echo
echo "--- Step 6: HTTP smoke test (health / create / get / delete) ---"

HEALTH=$(curl -s "${BASE}/api/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    pass "GET /api/health -> $HEALTH"
else
    fail "GET /api/health -> unexpected response: $HEALTH"
fi

CREATE_RESP=$(curl -s -X POST "${BASE}/api/entries" \
    -d '{"title":"diagnostic entry","body":"check_and_fix.sh test","mood":"calm"}')
NEW_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
if [ -n "$NEW_ID" ]; then
    pass "POST /api/entries -> created id=${NEW_ID}"
else
    fail "POST /api/entries -> unexpected response: $CREATE_RESP"
fi

GET_RESP=$(curl -s "${BASE}/api/entries")
if echo "$GET_RESP" | grep -q "$NEW_ID"; then
    pass "GET /api/entries -> new entry present"
else
    fail "GET /api/entries -> new entry NOT found. Response: $GET_RESP"
fi

if [ -n "$NEW_ID" ]; then
    DEL_RESP=$(curl -s -X DELETE "${BASE}/api/entries/${NEW_ID}")
    if echo "$DEL_RESP" | grep -q '"ok":true'; then
        pass "DELETE /api/entries/{id} -> $DEL_RESP"
    else
        fail "DELETE /api/entries/{id} -> unexpected response: $DEL_RESP"
    fi
fi

RECOV_RESP=$(curl -s "${BASE}/api/recovery-status")
if echo "$RECOV_RESP" | grep -q "replayedOnLastStartup"; then
    pass "GET /api/recovery-status -> $RECOV_RESP"
else
    fail "GET /api/recovery-status -> missing or not implemented: $RECOV_RESP"
fi

kill -9 "$SRV_PID" 2>/dev/null
wait "$SRV_PID" 2>/dev/null

# ── Step 7: short kill-loop crash test (10 iterations) ──────────────────
echo
echo "--- Step 7: quick crash-recovery test (10 kill -9 cycles) ---"
if [ -f "./kill_loop_test.sh" ]; then
    chmod +x ./kill_loop_test.sh
    KILL_LOG=$(./kill_loop_test.sh 10 "${PORT}" 2>&1)
    echo "$KILL_LOG" | sed 's/^/  /'
    if echo "$KILL_LOG" | grep -q "0 failures"; then
        pass "crash-recovery test: 0 failures across 10 runs"
    else
        fail "crash-recovery test reported failures — see log above"
    fi
else
    fail "kill_loop_test.sh not found in this directory — skipping"
fi

# ── Summary ──────────────────────────────────────────────────────────────
echo
echo "=================================================="
if [ "$STEP_FAILED" -eq 0 ]; then
    echo " ALL CHECKS PASSED — backend is working end-to-end."
else
    echo " SOME CHECKS FAILED — see [FAIL] lines above."
    echo " Paste the failing section back to Claude for an exact fix."
fi
echo "=================================================="

rm -f journal.db journal.db.wal journal.db.checkpoint
exit "$STEP_FAILED"
