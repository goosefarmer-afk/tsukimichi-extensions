interface Edges<T> {
  edges: T[];
}

export interface PopularMangaResult {
  data: {
    queryPopular: {
      recommendations: {
        anyCard: SearchManga | null;
      }[];
    };
  };
}

export interface SearchMangaResult {
  data: {
    mangas: Edges<SearchManga>;
  };
}

interface SearchManga {
  _id: string;
  name: string;
  thumbnail: string | null;
  englishName: string | null;
}

export interface MangaDetails {
  data: {
    manga: MKissaManga | null;
    episodeInfos: Chapter[];
  };
}

interface MKissaManga extends SearchManga {
  description: string | null;
  authors: string[] | null;
  genres: string[] | null;
  tags: string[] | null;
  altNames: string[] | null;
  status: string | null;
  malId: string | null;
  aniListId: string | null;
  availableChaptersDetail: {
    sub: string[];
  };
}

interface Chapter {
  episodeIdNum: string | number;
  notes: string | null;
  uploadDates: {
    sub: string | null;
  } | null;
}

export interface PageListData {
  chapterPages: Edges<Servers> | null;
}

interface Servers {
  pictureUrlHead: string | null;
  pictureUrls: { url: string }[];
}
