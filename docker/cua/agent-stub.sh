#!/usr/bin/env bash
set -euo pipefail

printf 'Schaltwerk CUA agent stub ready (%s)\n' "$(basename "$0")"
printf 'Arguments: %s\n' "$*"

while IFS= read -r line; do
    printf 'stub> %s\n' "$line"
done
