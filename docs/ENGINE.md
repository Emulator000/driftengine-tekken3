# What the game needs from DriftEngine

Requests to the engine, each with what it is for and what it would save. Remove an entry once a
release has it.

## The Android app held in landscape

`drift.package.json` has no way to say which way the app is held: the packager's activity is
`screenOrientation="unspecified"`, so `npm run android` builds from a copy of the packager's
templates whose activity is `sensorLandscape` (`--resources`), copied again from each release. An
`android.orientation` (`landscape`, `sensorLandscape`) written into the activity would let the copy
go.

## A mesh's colours rewritten in place

The ground's tiles are shaded each frame as the camera moves (the game darkens the floor with its
distance from the camera), and `updateMesh` rewrites positions and normals alone, so the ground is
made again as a new mesh nearly every frame: 295 of 301 frames measured in a fight, its positions
and map cells unchanged in all but 6. Colours rewritten in place (`updateMesh` taking `colors`, or
an `updateMeshColors`) would end the mesh made and let go each frame, a fifth of the drawing's
time on the main thread.

## Fighters skinned on the device

Each fighter is skinned on the main thread every frame (`Fighter.pose`: each vertex up to four
joint-space points, weighted, and a normal on one joint) and its positions and normals uploaded
(`updateMesh`, which measures their bounds again): 38% of the drawing's main-thread time in a
fight, a fifth of that the engine's upload. A skinned mesh taking per-influence
points, weights and joints, posed from the joints' transforms on the device, would leave the main
thread the joints alone.
