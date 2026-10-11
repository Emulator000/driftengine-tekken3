# What the game needs from DriftEngine

Requests to the engine, each with what it is for and what it would save. Remove an entry once a
release has it.

## The Android app held in landscape

`drift.package.json` has no way to say which way the app is held: the packager's activity is
`screenOrientation="unspecified"`, so a phone held upright shows the fight as a band across the
middle of the screen. A fighting game is played sideways: an `android.orientation` (`landscape`,
`sensorLandscape`) written into the activity would hold it so.
