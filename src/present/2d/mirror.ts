/**
 * The fight seen from the other side of the stage (`mirror.on`), as an online match shows it to the
 * player whose side is the other one's: the fight view's camera turned half round the point it looks
 * at (`other-side.ts`), so their fighter stands on the side they asked for, nothing drawn mirrored; the
 * HUD's plates swapped to stand over the fighter now on their side, and the stick's left and right
 * swapped with the picture.
 */
export const mirror = { on: false };
