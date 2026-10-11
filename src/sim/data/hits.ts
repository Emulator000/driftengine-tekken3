/**
 * The hits' tables: damage in percent by the hit sphere met, the joints the 14 hit spheres and the 8
 * push spheres sit on, and the points Yoshimitsu's sword and True Ogre's and Gon's tails hold out
 * from a joint.
 */
export interface HitTables {
  readonly damageByPart: readonly number[];
  readonly hitSphereJoints: readonly number[];
  readonly pushSphereJoints: readonly number[];
  readonly heldPoints: readonly (readonly number[])[];
}
