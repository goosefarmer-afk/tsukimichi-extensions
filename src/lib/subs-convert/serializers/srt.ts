import { type Cue, type ConvertOptions, DEFAULT_OPTIONS } from '../types';
import { msToSrtTime } from '../time';
import { renderCueLine } from './renderRuns';

/**
 * Serializes cues to SRT format.
 * @param cues - Cues to serialize
 * @param options - Serialization options (`preserveColor` controls `<font>` output)
 * @returns SRT file content
 */
export function serializeSrt(cues: Cue[], options: ConvertOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const blocks = cues.map((cue, i) => {
    const text = cue.lines.map((l) => renderCueLine(l, opts)).join('\n');
    return `${i + 1}\n${msToSrtTime(cue.start)} --> ${msToSrtTime(cue.end)}\n${text}`;
  });
  return blocks.join('\n\n') + '\n';
}
