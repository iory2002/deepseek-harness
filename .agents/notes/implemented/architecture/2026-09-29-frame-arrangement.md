# Agent Note: A configurable frame arrangement

Status: implemented

English | [中文](2026-09-29-frame-arrangement.zh.md)

## Problem

The frame's two flexible seats were fixed positions: ui-conversation declared `main` key `conversation`, ui-sidebar-right declared `rightbar`, and the column geometry, the edge-anchored panel, the resize handle placement, the collapse affordances, and the platform chrome were all written against those positions. Choosing a different arrangement — the workspace surface in the flexible center with the Conversation in a reserved right column — was reachable only by editing the frame and both feature packages, and no extension point could express the choice at all. A third-party plugin cannot render `root`, cannot move another plugin's registration between slots, and cannot declare a slot someone else declared, so no plugin-side workaround existed.

## Decision

`@deepseek-ai/dsh-client-ui-layout` owns a durable `arrangement` setting: one `.volatile()` `Config` field in the `ui-layout` settings namespace, default `conversation-center`, exposed by a `settings.general.item` row ("Interface layout") and settable from any profile patch on the plugin's row. The frame renders the same two declared seats at arrangement-dependent positions, and the `rightbar` owner share carries the arriving occupant's `role`:

| Arrangement | Flexible center | Right column |
|---|---|---|
| `conversation-center` | `main` (selected global panel, else `conversation`) | `rightbar`, `role: 'edge'` |
| `workspace-center` | `rightbar`, `role: 'plain'` (selected global panel takes the center) | `main` key `conversation` |

Because only positions change, no feature package registers twice and no child slot is declared twice: ui-conversation keeps its `main.conversation` subtree, ui-sidebar-right keeps its `rightbar.session` subtree, and `main` may be rendered at two sites when a global panel occupies the center.

`computeColumns` takes the same role. Under `edge` the solve is unchanged: the right column concedes to 300px, then yields its track, before the center drops below `CENTER_MIN`. Under `plain` the reserved column keeps its clamped preference (300px–70%) and the center absorbs the remainder down to zero, which the frame matches by dropping the grid template's protected center minimum for that arrangement.

ui-sidebar-right reads `role` from its owner share. Under `plain` it renders its content tree in normal flow, never slides or hides, forces a restored surface open, draws no panel chrome, reports no presentation or automatic-fullscreen fact, and answers its collapse and fullscreen commands with `command.plainColumn`; the docking kit, splitting, and floating panels stay available. Reporting nothing is deliberate: the frame sizes a plain column by arrangement rather than by occupant report, so no report exists to concede.

The live value belongs to the layout store, and `bindLayoutArrangement` keeps it in step with the Host-backed section: it adopts an accepted value, mirrors a local choice, and writes nothing before the Host accepts a section or while the section refuses writes. `ctx.layout.arrangement` is the live view occupants and commands read, so a switch takes effect without remounting the plugin.

## Alternatives considered

**Ship only the swapped layout.** Hard-coding the arrangement answers one preference and removes the shipped one; both arrangements are legitimate, and the choice belongs in configuration, per the rule that deployment-varying choices are validated `Config` fields.

**Let a plugin reorder the columns.** The frame, its grid template, the edge-anchored panel, the handle positions, and the Windows and macOS chrome all belong to ui-layout, and slot ownership forbids declaring another plugin's child slot. A CSS reordering plugin would leave the slide, fullscreen coverage, resize handle, and platform insets attached to the wrong edge — a surface that looks swapped and behaves wrong.

**Register each surface under both candidate parents.** The same child slots would be declared twice, which fails at load, and both seats would mount at once.

**Read the arrangement through a new global standard hook.** `provideRoot({ hooks })` plus a `GlobalStandardProps` member works, but it widens a framework-extensible interface for one package's fact; the store the frame already subscribes to carries it without new framework surface.

**Per-Session or per-window arrangements.** The frame's column model, its saved width, and the platform chrome are frame-wide facts, and two windows of one profile share the settings document; a per-Session arrangement would need a second geometry authority and would make one profile's windows disagree.

## Consequences

The arrangement is one profile-wide, durable choice; windows of a profile agree, and a switch re-renders both columns without remounting either plugin. Switching keeps the recorded panel width, opens a surface that the docked role had collapsed, and leaves the arriving surface to open through its own seat. `RightbarOwnerProps` gained `role`, which every `rightbar` occupant and every `rightbar.session` registrant composes; the frame's `role="edge"` path preserves the shipped behavior. Occupants that present differently per role read `ctx.layout.arrangement`; the shipped composition registers no second occupant. Unit coverage lives in ui-layout's columns, store, service, apply, arrangement-binding, settings-row, and frame specs, and in ui-sidebar-right's seat and command specs; the assembled Shortcut owners case covers the section never being written on unrelated store commits. See [the right-sidebar docking infrastructure](../feature/2026-09-04-right-sidebar-docking-infrastructure.md) for the docked surface this repositioning reuses, and [global main panels](2026-09-08-global-main-panels.md) for the center default the arrangement now selects.
