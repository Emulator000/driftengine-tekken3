# Contributing

By submitting a contribution, you represent that you have the right to submit the contributed
material and that it does not contain proprietary game code, game assets, confidential
information, unlawfully obtained material, or other third-party content that cannot legally be
redistributed.

Contributors must not submit Tekken 3 or Tekken 4 disc images, Tekken 3 arcade ROMs or board
dumps, executables, files from the discs or the board, anything extracted, decoded or converted
from them (models, textures, pictures, motion, sound, music, movies, stages), screenshots or
recordings of game content (test assets included), proprietary game code, decompiled or
disassembled code, security keys, or other restricted third-party material. Material copied from
MAME or another emulator is accepted only where its licence and provenance clearly allow it, and
is then credited in `THIRD_PARTY_NOTICES.md`.

Contributions to the arcade support consist only of independently written importer logic, parsers,
metadata descriptions and compatibility code that can legally be redistributed.

Acceptance of a contribution does not change ownership of third-party intellectual property.

Contributions are reviewed case by case. Submitting one does not, by itself, change the terms in
`LICENSE`; the copyright owner decides how accepted contributions are handled.

## Before submitting a pull request, confirm

- [ ] I authored this code or have permission to submit it
- [ ] It contains no disc images, arcade ROMs or board dumps, executables, or files from the discs or the board
- [ ] It contains nothing extracted, decoded or converted from them, and no build carrying it (an app)
- [ ] It contains no screenshots or recordings of game content
- [ ] It contains no decompiled or disassembled code, and no decompiler output or names
- [ ] It contains no security keys, and no copy protection, region lock or arcade security hardware bypass
- [ ] Third-party code is correctly attributed in `THIRD_PARTY_NOTICES.md`

Also run `npm test`, and follow the rules in `AGENTS.md`.
