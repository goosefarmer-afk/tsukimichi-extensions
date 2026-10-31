interface Anime {
  id: number;
  anime_id: number;
  anime_title: string;
  episode: number;
  anime_session: string;
  session: string;
  snapshot: string;
  created_at: string;
  completed: number;
}

interface Episode {
  id: number;
  anime_id: number;
  episode: number;
  title: string;
  session: string;
  created_at: string;
  filler: number;
}

export type EpisodeResponse = Response<Episode[]>;

export type LatestAnimeResponse = Response<Anime[]>;
export type SearchAnimeResponse = Response<SearchResult[]>;

interface SearchResult {
  id: number;
  title: string;
  episode: number;
  episodes: number;
  poster: string;
  session: string;
}

interface Response<T> {
  data: T;
  current_page: number;
  last_page: number;
}
