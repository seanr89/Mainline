#!/usr/bin/env bash
set -euo pipefail

# Generate synthetic Git repositories for benchmarking Mainline's cold scan
# (<1,000ms for 500 repos) and testing 2,000-row virtualized UI scrolling.
#
# Usage:
#   ./generate_benchmark_repos.sh [COUNT] [TARGET_DIR]

COUNT="${1:-500}"
TARGET_DIR="${2:-/tmp/mainline-bench-workspace}"

if ! [[ "$COUNT" =~ ^[0-9]+$ ]] || [ "$COUNT" -lt 1 ]; then
  echo "Error: COUNT must be a positive integer (got '$COUNT')." >&2
  exit 1
fi

rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"

echo "Generating $COUNT synthetic git repositories in $TARGET_DIR ..."

init_repo() {
  local idx="$1"
  local repo_dir="$TARGET_DIR/org-$((idx % 10))/service-$(printf '%04d' "$idx")"
  mkdir -p "$repo_dir"

  git -C "$repo_dir" init -q -b main
  git -C "$repo_dir" config user.name "Mainline Bench"
  git -C "$repo_dir" config user.email "bench@mainline.local"
  printf 'service-%04d\n' "$idx" > "$repo_dir/README.md"
  git -C "$repo_dir" add README.md
  git -C "$repo_dir" commit -q -m "feat: initial service-$idx scaffold"

  # Mix states across repositories so filters/badges can be exercised
  case $((idx % 10)) in
    1)
      # Dirty working tree
      echo "uncommitted edit" >> "$repo_dir/README.md"
      ;;
    2)
      # Off-main branch
      git -C "$repo_dir" checkout -q -b "feature/task-$idx"
      ;;
    3)
      # Detached HEAD
      local sha
      sha="$(git -C "$repo_dir" rev-parse HEAD)"
      git -C "$repo_dir" checkout -q "$sha"
      ;;
    4)
      # Untracked file (dirty)
      echo "scratch" > "$repo_dir/untracked.tmp"
      ;;
    *)
      ;;
  esac
}

# Run parallel batches of 16 to generate 500+ repos quickly without exhausting FDs
BATCH_SIZE=16
for ((i = 1; i <= COUNT; i++)); do
  init_repo "$i" &
  if (( i % BATCH_SIZE == 0 )); then
    wait
  fi
done
wait

echo "Done: created $COUNT repositories under $TARGET_DIR."
