# Agent Note: Per-token font overrides behind a settings table

Status: implemented

English | [中文](2026-09-29-per-token-font-overrides.zh.md)

## Problem

Typography was adjustable only through two integer axes (conversation content and workspace documents, 10–22 px). Every other font token — the three stacks, the Markdown ladder, the code family, the interface text scale — was compiled into `gradient-shadow-text.css`. A user who could not read the shipped stack (a missing CJK fallback, an unavailable first-choice family) or who needed larger code inside the conversation had no recourse short of editing the plugin's stylesheet, and no way back if that made text illegible. The two axes also gave no visibility: nothing in the product said which token drew which element.

## Decision

`@deepseek-ai/dsh-client-ui-theme` owns a closed typography catalog ([font-catalog.ts](../../../../packages/client/ui-theme/src/font-catalog.ts)) and a General Settings row that opens it as a table (`Token | Font family | Size | Used by`). Each catalog entry names one shorthand token, the elements it draws in localized copy, a self-demonstrating sample rendered with that token's live value, its shipped size and line-height ratio, and the built-in stack it embeds; entries whose tokens no feature component consumes (`--dsw-font-l-20`, `-m-18`, `-base-16`) are deliberately absent, so the table cannot offer a control that changes nothing. Family edits choose among four curated stacks; free-text stacks are rejected because an invalid stack is exactly the failure this table exists to repair.

An edit pins `{ token, size?, family? }` in the `ui-theme` namespace's new optional `fonts` array (`FONT_OVERRIDES_FIELD`). The snapshot publishes both the raw pins and their projection to CSS (`fontTokens`, built by `fontOverrideLayer`), and the document presenter — already the projection path for the two axes — writes those tokens as inline custom properties on body, which outrank the stylesheet ladder; the Host boot script writes the same projection before first paint. Sizes are clamped to each entry's own bounds and the wire schema rejects unknown tokens, unknown stacks, and out-of-range sizes. The two axis rows are edited through their existing durable fields rather than the pin list, so an axis keeps following its own semantics.

Recovery is explicit: a row's `Restore default` drops its pin (or returns an axis to 14 px), and the footer's confirmed `Restore all defaults` clears the field and both axes together. The entry row counts pinned tokens and changed axes, so the shipped composition is never silently replaced.

## Alternatives considered

**Expose every `--dsw-font-*` token, including the unreferenced scale.** A table listing tokens no component consumes teaches users to change nothing and hides which of forty rows matter; the closed catalog is the feature, not a limitation.

**Free-text font stacks.** The user's own words for the goal were "so I don't change the wrong thing"; accepting arbitrary CSS invites a typo that renders the interface unusable, and the recovery path would be the only defence.

**Ship it as a separate plugin.** The tokens, their defaults, the projection path, and the durability belong to the theme owner; a second plugin would need a new seam to write them, and the repository rule is that a feature owns its settings surface.

**Edit the stylesheet through a theme override layer (`ctx.theme.overrideTokens`).** That layer is the alias-token palette seam with per-scheme light/dark pairs; fonts are scheme-independent, and routing them there would entangle two independently evolving concerns.

**Let workspace previews follow a pinned Markdown or code size.** The preview root hosts the ladder and rebinds the content axis to the workspace axis, so body-level pins cannot reach it by construction. The catalog says so in those rows' descriptions rather than inventing a second pinning path.

## Consequences

A pinned token is absolute: that entry stops following its axis until released, and the table says which rows are pinned. Workspace previews keep following the workspace axis (their code family included), which the affected rows state in their own descriptions. The catalog is now a maintained contract — a token that gains or loses its last consumer must be added to or removed from it, and `FONT_ITEMS` feeds both the settings schema's token union and the table. Verification lives in the catalog, controller, presenter, dialog, entry-row, host-schema, and assembled-apply specs: the projection, the clamping, the refusal of unknown tokens, both restore paths, and the boot script carrying pins.
