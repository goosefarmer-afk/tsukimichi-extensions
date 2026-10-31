export interface PopularResult {
  data: {
    queryPopular: {
      recommendations: {
        anyCard: Card | null;
      }[];
    };
  };
}

interface Card {
  _id: string;
  name: string;
  thumbnail: string | null;
  englishName: string | null;
  nativeName: string | null;
  slugTime: string | null;
}

export interface SearchResult {
  data: {
    shows: {
      edges: Card[];
    };
  };
}

export interface AnimeDetails {
  data: {
    show: Omit<Show, "availableEpisodesDetail">;
  };
}

interface Show {
  _id: string;
  name: string;
  englishName: string | null;
  nativeName: string | null;
  thumbnail: string | null;
  isAdult: boolean;
  description: string | null;
  type: string | null;
  season: {
    quarter: string;
    year: number;
  } | null;
  score: number | null;
  genres: string[] | null;
  status: string | null;
  studios: string[] | null;
  airedStart: Aired | null;
  airedEnd: Aired | null;
  rating: string | null;
  availableEpisodesDetail: {
    sub: string[] | null;
    dub: string[] | null;
  };
}

export interface SeriesResult {
  data: {
    show: Pick<Show, "_id" | "availableEpisodesDetail">;
  };
}

interface Aired {
  year: number;
  month: number;
  date: number;
}

export interface EncryptedEpisodeResult {
  data: {
    tobeparsed: string | null;
  };
}

export interface AaApiError {
  errors:
    | {
        message: string | null;
        extensions?: {
          code: string | null;
        } | null;
      }[]
    | null;
}

export interface DecryptedEpisodeResult {
  episode: EpisodeResult["data"]["episode"];
}

export interface EpisodeResult {
  data: {
    episode: {
      sourceUrls: SourceUrl[];
    } | null;
  };
}

export interface SourceUrl {
  sourceUrl: string;
  type: string;
  sourceName: string;
  priority: number;
}
