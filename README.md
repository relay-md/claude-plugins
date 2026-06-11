# Relay Claude Code plugins

This repository is the public Claude Code plugin marketplace for Relay.

## Install

```text
/plugin marketplace add relay-md/claude-plugins
/plugin install documentation@relay
/reload-plugins
```

## Included plugins

- `documentation@relay` (`Relay Documentation`) searches and reads the public Relay documentation at `docs.relay.md`.

## Scope

`documentation@relay` is a zero-auth public-docs plugin. It does not access a
Relay account, Relay API, local Obsidian vault, local workspace, Relay Comms, or
user data.

The plugin can answer from the live public docs corpus. If the live docs are
unreachable, it falls back to the bundled public-docs snapshot and reports that
state through `documentation_status`.

## Uninstall note

Claude Code may retain an orphaned installed-plugin cache after uninstall. That
cache can include this plugin's code and bundled public Relay docs
snapshot/metadata. The payload does not leave plugin-authored fetched docs cache
or Relay account, workspace, vault, API, Comms, or user data.
