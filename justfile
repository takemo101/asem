set dotenv-load := false

default:
    @just --list

# Requires "$HOME/.bun/bin" on PATH (Bun adds it by default).
# Install a local asem CLI wrapper without changing the tracked entrypoint mode.
install:
    mkdir -p "$HOME/.bun/bin"
    rm -f "$HOME/.bun/bin/asem"
    printf '%s\n' '#!/usr/bin/env sh' 'exec bun "{{ justfile_directory() }}/packages/cli/src/index.ts" "$@"' > "$HOME/.bun/bin/asem"
    chmod 755 "$HOME/.bun/bin/asem"
    "$HOME/.bun/bin/asem" --help

# Remove the local asem CLI wrapper that `just install` created.
# This recipe only removes the dev-loop shell wrapper at ~/.bun/bin/asem.
uninstall:
    rm -f "$HOME/.bun/bin/asem"

# Install lefthook git hooks for this checkout.
hooks-install:
    bunx lefthook install

# Run the pre-commit hook without committing.
hooks-run:
    bunx lefthook run pre-commit --force

typecheck:
    bun run typecheck

test:
    bun run test

check:
    bun run check

fix:
    bun run fix

# Aggregate the documented local validation baseline (see AGENTS.md).
validate: typecheck test check
