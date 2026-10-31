import { type Cue, type ConvertOptions, DEFAULT_OPTIONS } from '../types';
import { msToVttTime } from '../time';
import { renderCueLine } from './renderRuns';

/**
 * Serializes cues to WebVTT format.
 * @param cues - Cues to serialize
 * @param options - Serialization options (`preserveColor` controls `<font>` output)
 * @returns WebVTT file content with `WEBVTT` header
 */
export function serializeVtt(cues: Cue[], options: ConvertOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const blocks = cues.map((cue) => {
    const text = cue.lines.map((l) => renderCueLine(l, opts)).join('\n');
    const settings = cue.vttSettings ? ` ${cue.vttSettings}` : '';
    const idLine = cue.vttIdentifier ? `${cue.vttIdentifier}\n` : '';
    return `${idLine}${msToVttTime(cue.start)} --> ${msToVttTime(cue.end)}${settings}\n${text}`;
  });
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}
