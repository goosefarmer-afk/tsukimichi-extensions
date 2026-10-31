interface Chapter {
  episodeTitle: string;
  viewerLink: string;
  episodeNo: number;
  exposureDateMillis: number;
  hasBgm: boolean;
}

export interface ChapterListResponse {
  result: {
    episodeList: Chapter[];
    nextCursor: number;
  };
}
