#!/usr/bin/env bash
# Runs INSIDE the test container. Copies the (read-only) source to a scratch
# dir, runs each stage, and writes logs + status.json to $RESULTS.
#
#   STAGES   space-separated subset of: preflight build lint unit integration
set -uo pipefail

SRC=${SRC:-/src}
WORK=${WORK:-/work}
RESULTS=${RESULTS:-/results}
DEPS=${DEPS:-/opt/deps}
CACHE=${CACHE:-/cache}
STAGES=${STAGES:-"preflight build lint unit integration"}

mkdir -p "$RESULTS" "$WORK" "$CACHE/vscode-test"
rm -f "$RESULTS"/*.log "$RESULTS"/*.xml "$RESULTS"/status.json "$RESULTS"/.stages.jsonl

# Fresh working copy: never write into the mounted source.
if ! rsync -a --delete \
    --exclude node_modules --exclude out --exclude .git \
    --exclude test-results --exclude .vscode-test \
    "$SRC"/ "$WORK"/; then
    echo "FATAL: could not copy source from $SRC to $WORK" | tee "$RESULTS/status.json" >&2
    echo '{"passed": false, "error": "source copy failed"}' >"$RESULTS/status.json"
    exit 2
fi
[ -d "$DEPS/node_modules" ] || { echo "FATAL: $DEPS/node_modules missing" >&2; echo '{"passed": false, "error": "deps missing"}' >"$RESULTS/status.json"; exit 2; }
# Tolerate a Windows checkout: the fake podman is executed through its shebang, so it needs LF endings.
sed -i 's/\r$//' "$WORK/test/fake-podman/podman.js" 2>/dev/null || true
chmod +x "$WORK/test/fake-podman/podman.js" 2>/dev/null || true
ln -sfn "$DEPS/node_modules" "$WORK/node_modules"
ln -sfn "$CACHE/vscode-test" "$WORK/.vscode-test"   # cached VS Code download
cd "$WORK" || exit 2

overall=0
started=$(date -u +%FT%TZ)

# run_stage <name> <command...>   -> $RESULTS/<name>.log, recorded in status.json
run_stage() {
    local name=$1; shift
    case " $STAGES " in *" $name "*) ;; *) return 0 ;; esac
    echo "=== stage: $name ==="
    local t0=$SECONDS
    "$@" >"$RESULTS/$name.log" 2>&1
    local code=$?
    local dur=$((SECONDS - t0))
    [ "$code" -ne 0 ] && overall=1
    printf '{"stage":"%s","exit_code":%d,"passed":%s,"seconds":%d,"log":"%s.log"}\n' \
        "$name" "$code" "$([ "$code" -eq 0 ] && echo true || echo false)" "$dur" "$name" \
        >>"$RESULTS/.stages.jsonl"
    if [ "$code" -eq 0 ]; then echo "    PASS (${dur}s)"; else echo "    FAIL (exit $code, ${dur}s) -> $name.log"; tail -n 15 "$RESULTS/$name.log" | sed 's/^/    | /'; fi
}

preflight() { podman info --format '{{.Host.Security.Rootless}} {{.Store.GraphDriverName}}' && podman --version && node --version; }
build()     { npx tsc -p ./; }
lint()      { npx eslint src --ext ts; }
unit()      {
    # REQUIRE_PODMAN: a missing podman is a failure here, not a silent skip.
    REQUIRE_PODMAN=1 npx mocha "out/test/unit/**/*.test.js" --ui tdd \
        --reporter ./test/reporters/spec-and-junit.js \
        --reporter-option "output=$RESULTS/unit-junit.xml"
}
integration() {
    # ELECTRON_ENABLE_LOGGING makes a crash explain itself in integration.log.
    ELECTRON_ENABLE_LOGGING=1 VSCODE_TEST_NO_SANDBOX=1 xvfb-run -a --server-args="-screen 0 1280x1024x24" npx vscode-test
}

run_stage preflight    preflight
run_stage build        build
# Later stages need the compiled output; skip them if the build broke.
if [ -s "$RESULTS/.stages.jsonl" ] && grep -q '"stage":"build","exit_code":[1-9]' "$RESULTS/.stages.jsonl"; then
    STAGES="preflight build"
fi
run_stage lint         lint
run_stage unit         unit
run_stage integration  integration

finished=$(date -u +%FT%TZ)
jq -s --arg s "$started" --arg f "$finished" --argjson ok "$([ $overall -eq 0 ] && echo true || echo false)" \
    '{passed: $ok, started: $s, finished: $f, stages: .}' "$RESULTS/.stages.jsonl" >"$RESULTS/status.json" 2>/dev/null \
    || echo "{\"passed\": $([ $overall -eq 0 ] && echo true || echo false)}" >"$RESULTS/status.json"
rm -f "$RESULTS/.stages.jsonl"
chmod -R a+rwX "$RESULTS" 2>/dev/null || true   # host user must be able to read/delete

echo "=== overall: $([ $overall -eq 0 ] && echo PASS || echo FAIL) ==="
exit $overall
