/** Optional local meshes fitted to Yoshimitsu's first-costume gameplay rig. */
import { readFighterMesh } from '../present/3d/fighter/fighter.ts';

export async function yoshimitsuOverride(pack: number, choice: string | null, load: (path: string) => Promise<ArrayBuffer>): Promise<ArrayBuffer | null> {
  if (pack !== 8 || (choice !== 'refined' && choice !== 'tag')) return null;
  try {
    const bytes = await load(`overrides/${choice === 'tag' ? 'yoshimitsu-tag' : 'yoshimitsu'}/08.ftr`);
    if (bytes.byteLength < 24) throw new Error('incomplete refined mesh');
    const header = new DataView(bytes);
    const vertices = header.getUint32(8, true), indices = header.getUint32(12, true);
    if (vertices < (choice === 'tag' ? 3 : 7329) || vertices > 65535 || indices < (choice === 'tag' ? 3 : 9918 * 3) || indices > 15000 * 3 || indices % 3) throw new Error('incompatible refined mesh counts');
    const mesh = readFighterMesh(bytes);
    const countsMatch = choice === 'tag'
      ? mesh.vertexCount >= vertices && mesh.vertexCount <= vertices * 2 && mesh.indices.length >= indices && mesh.indices.length <= indices * 2
      : mesh.vertexCount === vertices && mesh.indices.length === indices;
    if (mesh.rig !== null || !countsMatch ||
        mesh.joints.some((j) => j > 17) || mesh.normalJoint.some((j) => j > 17) ||
        mesh.indices.some((i) => i >= mesh.vertexCount)) throw new Error('incompatible refined mesh');
    for (let v = 0; v < mesh.vertexCount; v++) {
      const total = mesh.weights.subarray(v * 4, v * 4 + 4).reduce((a, b) => a + b, 0);
      if (!Number.isFinite(total) || Math.abs(total - 1) > 1e-6) throw new Error('invalid refined skin weights');
    }
    return bytes;
  } catch (error) {
    console.warn('Yoshimitsu refinement unavailable; using the selected original model.', error);
    return null;
  }
}
