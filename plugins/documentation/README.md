# Relay Documentation plugin

Relay Documentation lets Claude answer Relay setup, hosting, pricing,
shared-folder, sync, and troubleshooting questions from the public Relay docs.
It searches and reads docs.relay.md, returns links back to the source docs, and
stays inside Relay's documentation corpus. Use it when you are evaluating
Relay, setting up a Relay Server, checking sync behavior, or looking up a
documented product limit without leaving your Claude session.

This plugin does not read your Relay account, team workspace, Obsidian vault,
local files, Relay API, Relay Comms, or user data.

## Install

```text
/plugin marketplace add relay-md/claude-plugins
/plugin install documentation@relay
/reload-plugins
```

The `@relay` marketplace name is created by the marketplace add command. Pair
the install line with the source marketplace line in docs and support copy.

## First run

Ask Claude Code:

```text
Use the Relay Documentation plugin to answer: How do I set up Relay?
```

The plugin starts one local MCP server and exposes read-only public docs tools.
No channel flag, Relay login, server setup, or auth token is required.

The server refreshes from `https://docs.relay.md/llms.txt`,
`https://docs.relay.md/llms-full.txt`, and the optional
`https://docs.relay.md/llms-metadata.json` sidecar. If those URLs are
unavailable, it falls back to the bundled public-docs snapshot and reports that
state through `documentation_status`. By default it does not persist the public
docs corpus after a refresh. Set `RELAY_DOCUMENTATION_MCP_WRITE_CACHE=1` only if
you explicitly want a local cache for repeated offline use.

## Uninstall

```text
/plugin uninstall documentation@relay
```

This removes the plugin from Claude Code. It does not remove Relay, Obsidian, or
any user workspace content because this plugin never touches those surfaces. If
you enabled `RELAY_DOCUMENTATION_MCP_WRITE_CACHE=1`, remove the plugin data cache
shown by Claude Code as part of your local cleanup.

Claude Code may retain an orphaned installed-plugin cache after uninstall at a
path like `~/.claude/plugins/cache/relay/documentation/<version>/`. That cache
contains this plugin's code and bundled public-docs snapshot, marked with
`.orphaned_at`; it does not contain Relay account, workspace, vault, API, Comms,
or user data. It is safe to delete if you want to reclaim the disk space.
