/**
 * The build's scripts run gently, so a long extraction, import or remaster leaves the machine
 * usable: below its other work (the threads and processes they start after, ffmpeg and Python
 * among them, below it too), and their worker pools on half its cores at most.
 */
import { availableParallelism, constants, getPriority, setPriority } from 'node:os';

/** The script given way to the machine's other work: the lowest priority it may take. */
export function runGently() {
  try {
    if (getPriority() < constants.priority.PRIORITY_LOW) setPriority(constants.priority.PRIORITY_LOW);
  } catch {
    /* A system that will not lower it runs the script as it is. */
  }
}

/** How many workers a pool takes: half the machine's cores (`cores`) at most, one at least, and no more than there is work for (`jobs`). */
export const workersFor = (cores = availableParallelism(), jobs = Infinity) => Math.max(1, Math.min(jobs, Math.floor(cores / 2)));
