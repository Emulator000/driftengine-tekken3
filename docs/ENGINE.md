# What the game needs from DriftEngine

Requests to the engine, each with what it is for and what it would save. Remove an entry once a
release has it.

## A point skin's points rewritten in part

A fighter's hands change shape and its face blinks a few times a second (1 to 6 hand shapes and 1
to 2 faces a second each, measured in fights), and each change moves the points and normals of a
few hundred of its vertices, or takes a picture's weights away. `createPointSkin` takes a skin
whole, so the fighter makes its skin again on each change (`Fighter.pose`): the largest part of a
fighter's drawing on the main thread now, more than its poses (3.4% of the main thread with the
processor slowed four times). A rewrite of a range of a skin's vertices in place (their joints,
weights, points and normals), as `updateMeshColors` rewrites colours, would send the hundreds that
changed and keep the skin.

## The desktop shell's files read in ranges

The desktop app's `drift://` scheme streams each file whole, with neither a length nor an answer to
a `Range` request, so a `<video>` from it plays from its start but cannot be sought. The game seeks
its movie when the video falls behind the frame the game shows; in the Linux app, with its frames
held back to one or two a second, it sought 42 times in its first half minute, and the video went
back to its first frames each time rather than catching up. A `206` with `Content-Range` (and a
`Content-Length` on every answer) would let it seek as it does in a browser.
