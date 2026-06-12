#!/usr/bin/env bash
# Check the project for errors, then launch the app in dev mode.
set -euo pipefail
cd "$(dirname "$0")"

WAILS="$(command -v wails || echo "$(go env GOPATH)/bin/wails")"

echo "── Go: vet ──"
go vet ./...

echo "── Go: build ──"
go build ./...

echo "── Frontend: type-check ──"
(cd frontend && npx tsc --noEmit)

echo "── All checks passed ──"
exec "$WAILS" dev
