# Yoshimitsu and True Ogre enhancement handoff

> Session continuity document. Treat this as project context, not as an authorization to upload assets, spend credits, commit ignored game data, or change the user's scope.

## Objective

The user wants genuinely playable enhanced Tekken 3 fighter imports that visually approach Tekken Tag Tournament HD references. The two workstreams are Yoshimitsu and True Ogre. Preserve gameplay compatibility, rig/animation behavior, and local-only asset rules. Do not claim a pass is complete until the local game is reloaded and the rendered browser frame has been inspected.

## Repository and constraints

- Repository: `D:\driftengine-tekken3`
- Branch at capture: `codex/yoshimitsu-export`
- HEAD at capture: `6264092caaf03c17a3b5561bddfd08f37277c9db`
- Project rules are in `AGENTS.md`: disc/board/game assets stay ignored and local; no game content in git; no copy-protection work; use synthetic test data where possible.
- The local Vite game normally runs at `http://127.0.0.1:5190/`.
- Browser validation must use the active game URL, wait through the DriftEngine loading screen, and inspect the actual gameplay screenshot. A blank/loading screenshot is not validation.
- Never upload assets or spend cloud credits without explicit user approval.

## Yoshimitsu: current state

### User goal

The user asked for a playable Yoshimitsu model closer to the Tekken Tag HD reference: no visibly low-poly legs/helmet/mask, green light sword, green sword trail, preserved original gameplay rig and animation compatibility, and a separate override rather than modifying validated originals.

### Relevant authoritative files

- `src/app/quick.ts`: fighter asset selection and optional overrides. Yoshimitsu override selection is already wired here; keep pack/model routing explicit.
- `src/app/yoshimitsu.ts`: Yoshimitsu-specific override/runtime data.
- `src/present/3d/fighter/fighter.ts`: model draw/skin path. Changes here are high risk; validate animation and normal transforms after edits.
- `src/present/3d/effects/sword-trail.ts`: green sword trail effect. It is attack-triggered; idle/walk should not emit a trail.
- `scripts/fit-yoshimitsu-tag.py`, `scripts/prepare-yoshimitsu-tag.mjs`, `scripts/prepare-yoshimitsu-hd.mjs`, `scripts/prepare-yoshimitsu-30k.mjs`: source/fitting/export helpers.
- `tests/yoshimitsu-override.test.mjs`, `tests/yoshimitsu-tag.test.py`, `tests/yoshimitsu-refine.test.py`, `tests/sword-trail.test.mjs`: relevant regression checks.
- Local remaster folders under `local-remaster/yoshimitsu/` contain comparisons and generated local outputs; these are not public game data.

### What was completed

- Separate Yoshimitsu override work was created rather than overwriting the validated rounded/original model.
- Green sword material/trail behavior was added and tested as attack-only behavior.
- Geometry/UV/rig/export helpers and comparison pages were created through the session.
- Typecheck and targeted tests were run during earlier passes; rerun `npm test` before shipping any Yoshimitsu change.

### Yoshimitsu limitations to remember

- Texture upscaling alone does not create missing geometry. A 4K atlas cannot remove silhouette-level low-poly shapes.
- Do not blindly subdivide the full mesh: it damaged visual quality and inflated triangles without reference-backed detail.
- Preserve the validated original and rounded GLBs; write a new override/output.
- The user repeatedly reported that visual differences were not noticeable. Always show/inspect a before/after gameplay screenshot rather than relying on triangle counts or a generated file.

## True Ogre: current state

### Source and geometry

- User-provided/downloaded local archive was extracted under machine-local `.cache/true-ogre-tag/`.
- Raw source used: `True Ogre 1/ogre1u.obj`.
- Clean geometry: **5,650 triangles, 3,590 vertices**.
- Source report: no duplicate or degenerate faces were removed in the selected OBJ; 18-joint fitted rig; 5 animation clips; 4K atlas generated locally.
- Generated local source/output: `local-remaster/true-ogre/06b-parts/true_ogre.source.json`, `true_ogre.ftr`, `true_ogre.glb`, `mesh-report.json`, `true_ogre_diffuse_4k.png`.
- Installed local overrides: `public/assets/overrides/true-ogre/32.ftr`, `33.ftr`, `32.png`, `33.png`. These are ignored/local game assets and must not be committed.
- `scripts/prepare-true-ogre.mjs` currently reads from `local-remaster/true-ogre/06b-parts` and writes the FTR/GLB.

### Runtime routing

- True Ogre is roster index/model 20, but its correct model packs are **32 and 33**. Earlier routing under pack 20 loaded the original Tekken 3 model and created the false impression that the import had failed.
- `src/app/quick.ts` has `trueOgreOverride` routing for packs 32/33. Keep this routing; do not route the imported mesh through pack 20.

### Current visual/animation state

- Browser URL used: `http://127.0.0.1:5190/?p1=20&p2=0&cpu=0&models=rounded`.
- The game visibly loads True Ogre with `TRUE OGRE` HUD label, wings, horns, body, tail, Paul opponent, and gameplay frames.
- Wings are currently bound to side-specific animated joints `11/15`; this makes them move but can deform the silhouette.
- Tail is connected and the worst lower-tail stretch was reduced by binding material `_19` to torso-root joint `1`.
- Hand-shape deformation was disabled (`mesh['shapes']=[]`, animation pose `forms=[]`) because the original shape retarget produced detached/floating hand chunks. Five animation clips remain in the source/export.
- Current snake/forearm groups `_5/_6` use a 50/50 torso/upper-arm blend (`{1:0.5, 11:0.5}`); `_2/_3` and tail/root groups are torso-bound to avoid disconnection. This is stable but snake-arm motion is weak and not yet a faithful fix.
- Current last browser screenshot is visibly playable and connected enough for comparison, but the snake arm still needs proper orientation/root mapping. Do **not** call True Ogre fully fixed.

### True Ogre script state and likely next work

- `scripts/fit-true-ogre-tag.py` contains the material-part weighting rules. Inspect the `material.endswith` block before changing it.
- The fitter currently generates no hand shapes by design because the source material groups did not match the Yoshimitsu hand-shape reference and caused an `IndexError`/detached geometry.
- Next reliable path: identify the actual local skeleton joint transforms and the snake-arm vertex/material boundary, then use a two-joint blend with a calibrated local offset. Validate at idle, guard, attack, and movement frames. Do not guess another joint blindly.
- Keep a known-good backup of `local-remaster/true-ogre/06b-parts/true_ogre.source.json` before each experiment.

## Mistakes and lessons (do not repeat)

1. **Wrong pack routing:** installing True Ogre under pack 20 loaded the original Tekken 3 model. Correct packs are 32/33.
2. **Claiming success before browser inspection:** generated FTR/GLB and typecheck are insufficient. Reload, wait past the splash screen, inspect screenshot and console every pass.
3. **Axis-swap experiment:** swapping OBJ axes made the torso disappear. The accepted transform is the original `p * [0.32, 0.66, 0.45]`; do not reintroduce the axis swap without a side-by-side render.
4. **Blind global scaling:** changing x scale to `0.24` made the whole Ogre too small. Reverted to `0.32` after browser verification.
5. **Incorrect hand-shape retarget:** attaching the Yoshimitsu-style shape data to True Ogre caused floating/detached hand geometry. Shape data is currently disabled.
6. **Assuming torso/arm mapping from names:** material names do not prove the correct gameplay joint. The snake arm reversed/disconnected under guessed joints. Determine boundaries/transforms from the actual source and runtime.
7. **Texture-only expectations:** brightness/contrast and 4K atlas improve readability but cannot repair missing or wrongly bound geometry.
8. **Ignoring loading timing:** immediately after reload the browser may show only the DriftEngine splash. Wait several seconds and capture a gameplay frame.
9. **Do not mutate validated originals:** all generated overrides must remain separate and local.

## Verification checklist for every future edit

1. Run the narrow generator/export command.
2. Copy only the generated local FTR/texture into the ignored override path.
3. Run `npm run typecheck` when TypeScript/runtime code changed; run targeted Python/JS tests when fitter/export code changed.
4. Reload the local browser URL.
5. Wait through the loading screen.
6. Capture at least one neutral/guard frame and one moving/attack frame.
7. Check for: correct HUD/model pack, no blank screen, no console error, connected limbs, wing/tail motion, animation playback, and stable opponent/gameplay.
8. Record whether the pass is kept or rejected and why. Never report “fixed” from file generation alone.

## Useful commands

```powershell
# TypeScript validation
npm run typecheck

# Full project tests
npm test

# Regenerate True Ogre after editing the fitter
$obj=(Get-ChildItem -LiteralPath '.cache/true-ogre-tag' -Recurse -Filter 'ogre1u.obj' | Select-Object -First 1).FullName
python scripts/fit-true-ogre-tag.py $obj '.cache/true-ogre-fit-next'
Copy-Item '.cache/true-ogre-fit-next/true_ogre.source.json' 'local-remaster/true-ogre/06b-parts/true_ogre.source.json' -Force
node scripts/prepare-true-ogre.mjs
Copy-Item 'local-remaster/true-ogre/06b-parts/true_ogre.ftr' 'public/assets/overrides/true-ogre/32.ftr' -Force
Copy-Item 'local-remaster/true-ogre/06b-parts/true_ogre.ftr' 'public/assets/overrides/true-ogre/33.ftr' -Force
```

## Handoff status

Yoshimitsu has separate playable override infrastructure, green sword/trail behavior, and comparison/export tooling, but visual fidelity remains an ongoing enhancement task. True Ogre has a locally generated 5,650-triangle playable import routed through the correct packs with connected wings/tail/body and five clips, but snake-arm orientation/attachment is not fully solved. The next session should begin by reading `AGENTS.md`, inspecting the current fitter weighting block and source report, then performing one controlled snake-arm mapping experiment with mandatory browser screenshot validation.
