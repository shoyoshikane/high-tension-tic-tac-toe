#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
scaffold=$(mktemp -d)
trap 'rm -rf "$scaffold"' EXIT
flutter create --no-pub --platforms android,ios --org com.shoyoshikane --project-name high_tension_tic_tac_toe "$scaffold/app"
for platform in android ios; do
  if [ ! -d "$platform" ]; then cp -R "$scaffold/app/$platform" "$platform"; fi
done
if [ ! -f .metadata ]; then cp "$scaffold/app/.metadata" .metadata; fi
python3 tool/configure_platforms.py
flutter pub get
