/** Checks on loaded asset JSON. Each failure names the file and the field it found wrong. */

export class AssetError extends Error {
  constructor(where: string, problem: string) {
    super(`${where} ${problem}`);
    this.name = 'AssetError';
  }
}

export function expectObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new AssetError(where, 'is not an object');
  return value as Record<string, unknown>;
}

export function expectArray(value: unknown, where: string, length?: number): unknown[] {
  if (!Array.isArray(value)) throw new AssetError(where, 'is not an array');
  if (length !== undefined && value.length !== length) throw new AssetError(where, `has ${value.length} entries, not ${length}`);
  return value;
}

export function expectInt(value: unknown, where: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new AssetError(where, `is ${String(value)}, not an integer from ${min} to ${max}`);
  return value;
}

export function expectNumber(value: unknown, where: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new AssetError(where, `is ${String(value)}, not a number from ${min} to ${max}`);
  return value;
}

export function expectBoolean(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') throw new AssetError(where, 'is not true or false');
  return value;
}

export function expectString(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new AssetError(where, `is ${String(value)}, not a string`);
  return value;
}

/** An array of integers in a range, as a typed array. */
export function expectInts<T extends Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array>(
  value: unknown,
  where: string,
  length: number | undefined,
  make: (count: number) => T,
  min: number,
  max: number,
): T {
  const list = expectArray(value, where, length);
  const out = make(list.length);
  list.forEach((v, i) => {
    out[i] = expectInt(v, `${where}[${i}]`, min, max);
  });
  return out;
}
