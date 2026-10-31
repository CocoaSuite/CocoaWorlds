# Known Limitations

## Current

- No code exists yet; the project is in the architecture phase.

## Expected limitations of the proposed architecture

These follow from decisions in [DECISIONS.md](DECISIONS.md) and will be revisited if the decisions change.

- **Exported game size.** Desktop games carry an Electron runtime (Chromium), so even a tiny game is roughly 100 MB.
- **macOS distribution.** Signing and notarization need a Mac and an Apple Developer ID. Unsigned macOS builds show a Gatekeeper warning.
- **Windows distribution.** Unsigned builds show a SmartScreen warning until a code-signing certificate is used.
- **Geometry.** Brushes are convex. Concave shapes are made from several brushes (this is how carve results are represented). Arbitrary mesh booleans on imported models are not planned for v1.
- **Level scale.** No visibility precompilation (PVS); very large, dense levels rely on frustum culling and batching.
- **Web export.** Audio waits for the first click (browser autoplay rules); mouse look needs a click to lock the pointer; large assets download before play.
- **Custom code.** No user JavaScript in v1; behaviour is built with blocks.
- **Platforms.** The editor targets desktop and laptop screens only.

## Known bugs

None recorded yet.
