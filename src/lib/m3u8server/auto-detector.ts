export interface IntRange {
  readonly first: number;
  readonly last: number;
}

export class AutoDetector {
  // -------------------------------------------------------------------------
  // Magic headers for different formats
  // -------------------------------------------------------------------------

  private static readonly JPEG_HEADER = Uint8Array.from([0xff, 0xd8, 0xff]);
  private static readonly PNG_HEADER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  private static readonly GIF_HEADER = Uint8Array.from([0x47, 0x49, 0x46]);
  private static readonly MPEG_TS_SYNC = 0x47;
  private static readonly MP4_FTYP = Uint8Array.from([0x66, 0x74, 0x79, 0x70]); // "ftyp"
  private static readonly AVI_RIFF = Uint8Array.from([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  private static readonly AVI_AVI = Uint8Array.from([0x41, 0x56, 0x49, 0x20]); // "AVI "
  private static readonly MPEG_TS_PACKET_SIZE = 188;

  /**
   * Standard length of a single fake-header junk block. The obfuscators that
   * inject fake image magic bytes (ibyteimg / tiktokcdn variants observed in
   * ChillX-style streams) prepend a fixed 252-byte disguise chunk before
   * resuming the real format. This value is matched by `JunkBytesInterceptor`
   * in lib-multisrc/anikototheme and serves as the default junk-block length
   * when we can't positively identify where the junk ends.
   */
  private static readonly DEFAULT_JUNK_BLOCK_SIZE = 252;

  /**
   * Maximum distance from a junk-magic header to search for the next valid
   * video format boundary when determining the end of the junk block. Capped
   * at 8 KB so a stray magic header embedded inside a long real segment does
   * not blow up the scan into a buffer-size chase.
   */
  private static readonly JUNK_END_SEARCH_LIMIT = 8 * 1024;

  /** Not instantiable — all functionality is exposed via static methods. */
  private constructor() {}

  /**
   * Automatically detects how many bytes to skip at the beginning of the file.
   *
   * NOTE: This is the legacy prefix-only entry point — it inspects only the
   * leading portion of the buffer and returns a single offset. For segments
   * potentially containing junk blocks interleaved past the first 4 KB (the
   * ChillX-style obfuscation pattern), use `detectInterleavedSkips`, which
   * scans the entire buffer and returns a list of regions to strip.
   *
   * @param data File data (first 4KB is sufficient)
   * @return Number of bytes to skip
   */
  static detectSkipBytes(data: Uint8Array): number {
    if (data.length === 0) return 0;

    // If it's already a valid MPEG-TS, don't need to skip anything
    if (AutoDetector.isMpegTsValid(data)) return 0;

    // If it's JPEG/PNG/GIF disguising another format
    if (
      AutoDetector.isJpegHeader(data) ||
      AutoDetector.isPngHeader(data) ||
      AutoDetector.isGifHeader(data)
    ) {
      return AutoDetector.detectDisguise(data);
    }

    // If it's already a valid video format
    if (AutoDetector.isVideoFormat(data)) return 0;

    // Unrecognized pattern, don't skip anything
    return 0;
  }

  /**
   * Scans the ENTIRE buffer for fake-image junk blocks (JPEG / PNG / GIF
   * magic bytes) inserted at any offset to disguise the underlying video
   * stream, and returns the sorted, non-overlapping list of byte ranges that
   * should be stripped from the buffer before the result is served to the
   * player.
   *
   * Each returned `IntRange` is an inclusive-inclusive `[first, last]` pair
   * covering bytes that are junk data and must NOT be forwarded. Callers
   * re-assemble the segment by keeping every byte NOT covered by any
   * returned range, in order.
   *
   * ### Detection algorithm
   *
   * For every offset `i` in the buffer whose 3-4 byte prefix matches JPEG /
   * PNG / GIF magic, the detector walks forward up to `JUNK_END_SEARCH_LIMIT`
   * bytes looking for a valid **video format boundary**:
   *  - MPEG-TS: a 0x47 sync byte followed by at least 2 more 0x47 bytes at
   *    188-byte strides (validated by `isMpegTsValidAt`)
   *  - MP4: a 4-byte big-endian size followed by "ftyp"
   *  - AVI: a "RIFF" marker immediately followed by "AVI "
   *
   * If a boundary is found within the search window, the junk block ends
   * just before that boundary. If no boundary is found, the junk block is
   * assumed to be a fixed `DEFAULT_JUNK_BLOCK_SIZE` bytes long (matching the
   * pattern produced by the most-common ibyteimg/tiktokcdn injectors).
   *
   * Junk blocks that overlap (or that fall entirely inside another junk
   * region) are merged. Ranges starting past the buffer end are dropped.
   *
   * @param data Full segment buffer (NOT truncated to 4 KB)
   * @return Sorted, non-overlapping `IntRange`s of junk bytes to strip.
   *         Empty array if no junk is detected.
   */
  static detectInterleavedSkips(data: Uint8Array): IntRange[] {
    if (data.length === 0) return [];

    const regions: IntRange[] = [];
    const MIN_GAP_BETWEEN_JUNK = 1024; // Minimum bytes between junk blocks

    let i = 0;
    let lastJunkEnd = -MIN_GAP_BETWEEN_JUNK;

    while (i < data.length - 2) {
      // Skip if we're too close to the last detected junk
      if (i < lastJunkEnd + MIN_GAP_BETWEEN_JUNK) {
        i++;
        continue;
      }

      const junkEnd = AutoDetector.detectJunkBlockEnd(data, i);
      if (junkEnd >= 0) {
        let hasValidTs = false;
        for (
          let check = i;
          check < Math.min(junkEnd, i + AutoDetector.MPEG_TS_PACKET_SIZE * 3);
          check++
        ) {
          if (
            data[check] === AutoDetector.MPEG_TS_SYNC &&
            AutoDetector.isMpegTsValidAt(data, check)
          ) {
            hasValidTs = true;
            break;
          }
        }

        if (!hasValidTs && junkEnd > i + 16) /* Require at least some junk bytes */ {
          regions.push(AutoDetector.range(i, Math.min(junkEnd - 1, data.length - 1)));
          lastJunkEnd = junkEnd;
          i = junkEnd;
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    return AutoDetector.mergeRegions(regions);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Builds an inclusive `IntRange` from a `[first, last]` pair. */
  private static range(first: number, last: number): IntRange {
    return { first, last };
  }

  /**
   * If `offset` looks like the start of a fake-image junk block, returns
   * the EXCLUSIVE end offset (i.e. the index of the first byte AFTER the
   * junk block). Returns -1 if `offset` is not a junk-magic header.
   *
   * The returned end is always `> offset` for a real junk block, and is
   * clamped to `data.length`.
   */
  private static detectJunkBlockEnd(data: Uint8Array, offset: number): number {
    const isJpeg =
      offset + 2 < data.length &&
      data[offset] === AutoDetector.JPEG_HEADER[0] &&
      data[offset + 1] === AutoDetector.JPEG_HEADER[1] &&
      data[offset + 2] === AutoDetector.JPEG_HEADER[2];
    const isPng =
      offset + 3 < data.length &&
      data[offset] === AutoDetector.PNG_HEADER[0] &&
      data[offset + 1] === AutoDetector.PNG_HEADER[1] &&
      data[offset + 2] === AutoDetector.PNG_HEADER[2] &&
      data[offset + 3] === AutoDetector.PNG_HEADER[3];
    const isGif =
      offset + 2 < data.length &&
      data[offset] === AutoDetector.GIF_HEADER[0] &&
      data[offset + 1] === AutoDetector.GIF_HEADER[1] &&
      data[offset + 2] === AutoDetector.GIF_HEADER[2];

    if (!isJpeg && !isPng && !isGif) return -1;

    const searchEnd = Math.min(data.length, offset + AutoDetector.JUNK_END_SEARCH_LIMIT);

    let i = offset + 1;
    while (i < searchEnd) {
      if (i + 8 <= searchEnd && AutoDetector.isFtypAt(data, i)) {
        return i;
      }
      if (i + 12 <= searchEnd && AutoDetector.isRiffAviAt(data, i)) {
        return i;
      }
      if (data[i] === AutoDetector.MPEG_TS_SYNC && AutoDetector.isMpegTsValidAt(data, i)) {
        return i;
      }
      i++;
    }

    return Math.min(data.length, offset + AutoDetector.DEFAULT_JUNK_BLOCK_SIZE);
  }

  /**
   * Returns true if an MP4 "ftyp" atom begins at `offset`. The 4-byte size at
   * [offset, offset+3] is intentionally NOT validated. Caller MUST ensure
   * `offset + 8 <= data.length` before invoking.
   */
  private static isFtypAt(data: Uint8Array, offset: number): boolean {
    return (
      data[offset + 4] === AutoDetector.MP4_FTYP[0] &&
      data[offset + 5] === AutoDetector.MP4_FTYP[1] &&
      data[offset + 6] === AutoDetector.MP4_FTYP[2] &&
      data[offset + 7] === AutoDetector.MP4_FTYP[3]
    );
  }

  /**
   * Returns true if a RIFF/AVI magic block begins at `offset`. Caller MUST
   * ensure `offset + 12 <= data.length` before invoking.
   */
  private static isRiffAviAt(data: Uint8Array, offset: number): boolean {
    return (
      data[offset] === AutoDetector.AVI_RIFF[0] &&
      data[offset + 1] === AutoDetector.AVI_RIFF[1] &&
      data[offset + 2] === AutoDetector.AVI_RIFF[2] &&
      data[offset + 3] === AutoDetector.AVI_RIFF[3] &&
      data[offset + 8] === AutoDetector.AVI_AVI[0] &&
      data[offset + 9] === AutoDetector.AVI_AVI[1] &&
      data[offset + 10] === AutoDetector.AVI_AVI[2] &&
      data[offset + 11] === AutoDetector.AVI_AVI[3]
    );
  }

  /**
   * Validates a MPEG-TS sync grid starting at `start`: checks for at least
   * 2 consecutive 188-stride 0x47 sync bytes within the next 1 KB, without
   * requiring the entire buffer to be MPEG-TS-aligned. Used to confirm a
   * video format boundary after a junk block.
   */
  private static isMpegTsValidAt(data: Uint8Array, start: number): boolean {
    if (start + AutoDetector.MPEG_TS_PACKET_SIZE > data.length) return false;
    if (data[start] !== AutoDetector.MPEG_TS_SYNC) return false;
    let valid = 0;
    let j = start;
    const ceiling = Math.min(data.length, start + 1024);
    while (j < ceiling) {
      if (
        j + AutoDetector.MPEG_TS_PACKET_SIZE <= data.length &&
        data[j] === AutoDetector.MPEG_TS_SYNC
      ) {
        valid++;
      }
      j += AutoDetector.MPEG_TS_PACKET_SIZE;
    }
    return valid >= 2;
  }

  /**
   * Merges overlapping or adjacent junk regions into a sorted,
   * non-overlapping list. Adjacent regions (the end of one is the start of
   * the next) are merged too — strips two back-to-back junk blocks as one
   * continuous gap.
   */
  private static mergeRegions(regions: IntRange[]): IntRange[] {
    if (regions.length === 0) return [];
    const sorted = [...regions].sort((a, b) => a.first - b.first);
    const merged: IntRange[] = [];
    let current = sorted[0]!;
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i]!;
      if (next.first <= current.last + 1) {
        current = AutoDetector.range(current.first, Math.max(current.last, next.last));
      } else {
        merged.push(current);
        current = next;
      }
    }
    merged.push(current);
    return merged;
  }

  /**
   * Checks if it's a valid MPEG-TS stream
   */
  static isMpegTsValid(data: Uint8Array): boolean {
    if (data.length < AutoDetector.MPEG_TS_PACKET_SIZE) return false;

    // Check if the first byte is sync byte
    if (data[0] !== AutoDetector.MPEG_TS_SYNC) return false;

    // Check if there are multiple sync bytes in correct locations
    let validPackets = 0;
    for (let i = 0; i < Math.min(data.length, 1024); i += AutoDetector.MPEG_TS_PACKET_SIZE) {
      if (
        i + AutoDetector.MPEG_TS_PACKET_SIZE <= data.length &&
        data[i] === AutoDetector.MPEG_TS_SYNC
      ) {
        validPackets++;
      }
    }

    return validPackets >= 3;
  }

  /**
   * Checks if it starts with JPEG header
   */
  private static isJpegHeader(data: Uint8Array): boolean {
    if (data.length < 3) return false;
    return (
      data[0] === AutoDetector.JPEG_HEADER[0] &&
      data[1] === AutoDetector.JPEG_HEADER[1] &&
      data[2] === AutoDetector.JPEG_HEADER[2]
    );
  }

  /**
   * Checks if it starts with PNG header
   */
  private static isPngHeader(data: Uint8Array): boolean {
    if (data.length < 4) return false;
    return (
      data[0] === AutoDetector.PNG_HEADER[0] &&
      data[1] === AutoDetector.PNG_HEADER[1] &&
      data[2] === AutoDetector.PNG_HEADER[2] &&
      data[3] === AutoDetector.PNG_HEADER[3]
    );
  }

  /**
   * Checks if it starts with GIF header
   */
  private static isGifHeader(data: Uint8Array): boolean {
    if (data.length < 3) return false;
    return (
      data[0] === AutoDetector.GIF_HEADER[0] &&
      data[1] === AutoDetector.GIF_HEADER[1] &&
      data[2] === AutoDetector.GIF_HEADER[2]
    );
  }

  /**
   * Detects if a video is disguised under another format
   */
  private static detectDisguise(data: Uint8Array): number {
    // Look for MP4 "ftyp" box
    const ftypOffset = AutoDetector.findPattern(data, AutoDetector.MP4_FTYP);
    if (ftypOffset >= 4) {
      return ftypOffset - 4; // "ftyp" is preceded by 4 bytes of size
    }

    // Look for AVI "RIFF"
    const riffOffset = AutoDetector.findPattern(data, AutoDetector.AVI_RIFF);
    if (riffOffset > 0) {
      return riffOffset;
    }

    // Look for MPEG-TS sync byte
    const mpegTsOffset = AutoDetector.findMpegTsSync(data);
    if (mpegTsOffset > 0) {
      return mpegTsOffset;
    }

    return 0;
  }

  /**
   * Checks if it's already a valid video format
   */
  private static isVideoFormat(data: Uint8Array): boolean {
    return (
      AutoDetector.isMpegTsValid(data) ||
      AutoDetector.findPattern(data, AutoDetector.MP4_FTYP) >= 0 ||
      AutoDetector.findPattern(data, AutoDetector.AVI_RIFF) >= 0
    );
  }

  /**
   * Finds a specific pattern in the data
   */
  private static findPattern(data: Uint8Array, pattern: Uint8Array): number {
    for (let i = 0; i <= data.length - pattern.length; i++) {
      let found = true;
      for (let j = 0; j < pattern.length; j++) {
        if (data[i + j] !== pattern[j]) {
          found = false;
          break;
        }
      }
      if (found) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Finds the first MPEG-TS sync byte
   */
  private static findMpegTsSync(data: Uint8Array): number {
    for (let i = 0; i < data.length; i++) {
      if (data[i] === AutoDetector.MPEG_TS_SYNC) {
        // Check if there's a pattern of sync bytes
        let validCount = 0;
        for (
          let j = i;
          j < Math.min(data.length, i + 1024);
          j += AutoDetector.MPEG_TS_PACKET_SIZE
        ) {
          if (
            j + AutoDetector.MPEG_TS_PACKET_SIZE <= data.length &&
            data[j] === AutoDetector.MPEG_TS_SYNC
          ) {
            validCount++;
          }
        }
        if (validCount >= 2) {
          return i;
        }
      }
    }
    return -1;
  }
}

export default AutoDetector;
