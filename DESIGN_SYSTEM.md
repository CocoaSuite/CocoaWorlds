# CocoaWorlds Design System

CocoaWorlds is a member of the Cocoa software family. Its editor must look and behave like CocoaCanvas. This document records what CocoaCanvas actually does, taken from its source, and how CocoaWorlds extends it.

**Reference inspected:** `CocoaSuite/cocoacanvas`, `editor.html` (the shipped editor; identical to `CocoaCanvas-standalone.html`).

## 1. What CocoaCanvas is, technically

| Aspect | Finding | Consequence for CocoaWorlds |
|---|---|---|
| Distribution | One self-contained ~780 KB HTML file plus a PWA shell (`index.html`, `manifest.webmanifest`, `sw.js`). | There is no component source to import. |
| Code | One ~660 KB vanilla JavaScript bundle. No framework, no build artefacts from React/Vue/Svelte. DOM is built with template strings and `innerHTML`. | Components are reproduced, not imported. Class names and tokens are copied verbatim so the two products stay in step. |
| Styling | One ~63 KB stylesheet driven by CSS custom properties on `:root`. | Tokens below are lifted 1:1 into `packages/ui/tokens.css`. |
| State | Module-level variables (`doc`, `sel`, `tool`, `view`) plus an `IDX` map for lookups. | CocoaWorlds needs a store (see ARCHITECTURE.md); behaviour, not implementation, is mirrored. |
| Undo | Whole-document JSON snapshots: `commit()` pushes the previous snapshot onto a 200-entry history; `undo()`/`redo()` restore. | CocoaWorlds uses command/transaction undo (snapshots of a 3D level are too large), but keeps the same 200-step depth and the same "commit after each finished gesture" rhythm. |
| Persistence | IndexedDB database `cocoacanvas` (key/value store) and `localStorage` keys prefixed `cv-`. | CocoaWorlds stores projects as real folders on disk. UI preferences use the `cw-` prefix. |
| Language | Every string is English with a Russian twin (`L('Menu','Меню')`, `data-ru` attributes). Language follows `navigator.language`, overridable. | CocoaWorlds ships English and Russian from day one using a string table, not inline pairs. |
| Theme | Dark only (`color-scheme: dark`). | Dark only. |

## 2. Tokens

### 2.1 Colour

| Token | Value | Use |
|---|---|---|
| `--bg` | `#121212` | App background, input fields |
| `--panel` | `#1a1a1a` | Top bar, sidebars, tool bar, dialogs |
| `--panel2` | `#252525` | Buttons, dropdown menus, raised rows, hovered rows |
| `--line` | `#303030` | Every 1px border and divider |
| `--fg` | `#ececec` | Primary text |
| `--mute` | `#8f8f8f` | Secondary text, section labels, inactive icons |
| `--pri` / `--prifg` | `#f2f2f2` / `#111` | Primary button (white with near-black text); active tool |
| `--acc` / `--accfg` | `#4a4a4a` / `#ffffff` | Neutral accent fill |
| `--hl` | `#ffffff` | Focus outline |
| `--sel` | `#4b9cff` | Selection outlines, handles, drop indicators, selection badges |
| (row selected) | `#2d3a4d` | Selected row background in lists |
| (menu hover) | `#363636` | Hovered item inside a dropdown |
| `--bad` | `#ff8a73` | Errors, destructive states |
| `--guide` | `#ff5b8a` | Smart guides / snapping lines |
| `--cbg` | `#1f1f1f` | Canvas (viewport) background |
| `--chk` | 8px conic checkerboard `#5a5a5a`/`#3a3a3a` | Transparency |

**Brand colour.** CocoaCanvas uses its brand orange `#D15A2C` sparingly: switched-on toggles, checked boxes in export lists, "new" badges, onboarding progress dots and drag-reorder indicators. It never colours general chrome.

CocoaWorlds' brand colour is the olive from its logo, **`#637F2A`**, used in exactly those roles. The logo's cream `#F6F1EB` is used only inside the logo.

New CocoaWorlds-only semantic colours (dark-background contrast checked against `#1a1a1a`):

| Token | Value | Use |
|---|---|---|
| `--cw-brand` | `#637F2A` | Toggles on, checkboxes, progress fills (never body text) |
| `--cw-brand-hi` | `#8FB04A` | Brand-coloured text and icons, "live/running" indicators |
| `--cw-warn` | `#F0A442` | Warnings, missing assets, trigger volumes in the viewport |
| `--cw-axis-x` / `-y` / `-z` | `#FF6B5B` / `#8FD14F` / `#4B9CFF` | Gizmo axes and X/Y/Z field labels |
| `--cw-entity` | `#4B9CFF` tint `#1D2A3A` / border `#2F4D70` | Entity reference slots in script blocks |
| `--cw-event` | `#3B4A1C` / border `#5A7128` | "When…" event blocks |

### 2.2 Typography

- Sans: `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif` — no web fonts.
- Mono: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` — numbers in fields, zoom label, console, hex values.
- Base: **13px / 1.4**.
- Section labels: 11px, uppercase, `letter-spacing: .08em`, `--mute`.
- Dialog titles: 16px (18px in the shipped build), weight 600.
- Primary buttons: weight 600. Nothing else is bold by default.
- Touch (`pointer: coarse`) raises body to 15–16px. CocoaWorlds is desktop-only and does not carry the touch overrides.

### 2.3 Spacing, radii, shadows

- Gaps are small and dense: 3, 5, 6, 8, 10, 12px. Panel padding `10px 12px`. Field grid: `96px label | 1fr` with 8px gap.
- Radii: 4px (menu items), 5px (inputs), 6px (buttons), 7px (dropdowns, popovers), 10px (dialogs, cards). Pills 999px.
- Shadows only on floating surfaces: dropdowns `0 10px 28px rgba(0,0,0,.45)`, dialogs and floating panels `0 10px 30px rgba(0,0,0,.5)`.
- Motion: 0.15s for toggles, 0.2s opacity for toasts, 0.3s eased slides for panels. Everything respects `prefers-reduced-motion`.

## 3. Layout

```
┌ #top 38px ─ logo │ menus │ project name │ status ……… undo redo │ secondary │ PRIMARY ┐
├ #lay 240px ┬──────── #stage ────────────────────────────┬ #inspW 264px ┤
│ .ph header │ #view  (canvas, --cbg)                      │ .ph header    │
│ search     │                                             │ .sec sections │
│ .lr rows   ├ #tbar  centred tool buttons 34×30 ─────────┤ .f fields     │
└────────────┴─────────────────────────────────────────────┴───────────────┘
```

CocoaWorlds keeps this frame exactly and adds one thing: a collapsible **bottom workspace** inside `#stage` below `#tbar` (scripts, assets, console, problems, diagnostics) with a 30px tab strip. Workspaces (Level / Script / Materials) are a segmented control in the top bar, not separate windows.

## 4. Components (CocoaCanvas class → CocoaWorlds component)

| CocoaCanvas | Look and behaviour | CocoaWorlds component |
|---|---|---|
| `button` | `--panel2` fill, 1px `--line`, 6px radius, `5px 10px`; hover changes only the border to `--mute`; disabled = 45% opacity | `Button` |
| `button.pri` | `--pri` fill, dark text, 600 weight; hover goes to pure white | `Button variant="primary"` (Play, New project, Build) |
| `.ic` | Icon-only button, 16px stroke icon, `stroke-width:2`, round caps | `IconButton` (always has `aria-label`) |
| `#tbar .ic` | 34×30, transparent until hover; active tool is filled `--pri` | `ToolButton` |
| `.vs` | 1×20px vertical divider, 6px margins | `Divider` |
| `.mt` + `.dd` | Text menu button; dropdown on `--panel2`, 7px radius, 4px padding, items 6px 10px, hover `#363636`, `hr` separators, current item gets a checkmark mask | `Menu`, `MenuItem`, `MenuSeparator` |
| `#ctx` | Same look as `.dd`, positioned at pointer, built from the same item list as menus | `ContextMenu` |
| `.ph` | Panel header: 11px uppercase label left, small button right | `PanelHeader` |
| `.lr` | 28px tree row: disclosure triangle, 13px icon, name with ellipsis, hover-only action buttons (eye, lock), selected `#2d3a4d`, hidden rows at 45% | `TreeRow` |
| `#dropLn` | 2px `--sel` insertion line; "drop into" is a 28px outlined box | `TreeDropIndicator` |
| `.sec` | Inspector section: uppercase label with top border, optional `+` | `InspectorSection` |
| `.f` | Label/field grid row | `Field` |
| `.nf` | Number field with a scrub label (drag horizontally to change) | `NumberField` (scrubbing included) |
| `.g2` | Two-column field group | `FieldGroup` (CocoaWorlds adds a 3-column X/Y/Z variant) |
| `.seg` | Segmented icon/text buttons, selected = `--panel2` with border | `Segmented` |
| `.sw2` | 42×24 switch; on = brand colour, knob white | `Switch` (brand olive) |
| `.cr` | Colour swatch + mono hex + opacity field | `ColorField` |
| `.modal .box` | Scrim `rgba(0,0,0,.6)`, box `--panel`, 10px radius, 18px padding, 12px gap | `Dialog` |
| `#toast` | Bottom-centre pill on `--panel2`, fades after 2.4s | `Toast` |
| `kbd` | Mono 12px key cap on `--panel2` | `Kbd` |
| `.empty` | Muted helper text in empty lists | `EmptyState` |
| `.hd`, `.hr`, `.badge` | White handles with `--sel` stroke; selection badge `--sel` with white 11px text | Viewport overlay styles |

## 5. Interaction conventions to keep

- **Keyboard:** Space held = temporary pan. Esc steps out one level (exit sub-mode → leave group → back to Select tool → clear selection). Enter steps in. F2 renames. Delete/Backspace deletes. Arrows nudge (Shift = larger step). `?` opens the shortcut sheet.
- **Modifier shortcuts:** Ctrl/⌘ + Z undo, Shift+Z / Y redo, D duplicate, G group, Shift+G ungroup, A select all, S save, Shift+S save as, O open, `[` `]` reorder, `=` `-` `0` zoom.
- **Tool letters:** CocoaCanvas uses V move, H hand, R rect, O ellipse, L line, P pen, T text. CocoaWorlds keeps V (select) and H (pan). Proposed 3D mapping, to be confirmed in Phase 2: W move, E rotate, R scale, B block brush, C clip, X vertex, F face, Shift+F frame selected. The final mapping will be listed in the editor's `?` sheet.
- **Fields never steal shortcuts:** keydown inside inputs stops propagation; Enter commits, Esc cancels.
- **Shortcut keys are read by physical layout** (CocoaCanvas' `latKey`), so shortcuts work with a Russian keyboard layout.
- **Inline rename:** double-click or F2 swaps the row label for a 22px input.
- **Undo granularity:** one entry per completed gesture (drag end, field commit), never per pointer-move.

## 6. Rules for new CocoaWorlds UI

1. Start from a component in section 4. Only create a new one when none fits, and build it from the tokens in section 2.
2. Chrome is grey. Colour means something: blue = selected, olive = on/live, amber = warning, coral = error, axis colours = axes.
3. One primary (white) button per surface.
4. Panel content uses 13px text, 11px uppercase section labels, 28px rows.
5. Icons are 16px stroke icons (`stroke-width` 1.8–2, round joins). No emoji, no filled icon sets.
6. No gradients, glows or coloured card edges in chrome. The viewport and material previews are the only places with rendered imagery.
7. Every icon-only control has a label; every floating surface closes with Esc.
8. Write labels in plain language. Scripting especially: "When the player enters…", not "OnTriggerEnter".

## 7. Approved mockups

The approved editor mockups (level editor, plain-language block scripting, play mode, project manager, materials, build) live on the design canvas "CocoaWorlds Editor Mockups". They are the visual target for Phase 2 onward.
