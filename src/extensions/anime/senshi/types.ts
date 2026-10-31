export interface FilterResponse {
  total: number | null;
  data: SenshiAnime[];
}

export interface SenshiAnime {
  id: number;
  public_id: string;
  anime_picture: string | null;
  title: string | null;
  title_english: string | null;
  synonyms: string | null;
  type: string | null;
  ani_source: string | null;
  ani_episodes: string | null;
  ani_status: string | null;
  airing_date: string | null;
  duration: string | null;
  score: number | null;
  genres: string | null;
  studios: string | null;
  tvdb_id: number | null;
  anilist_id: number | null;
  sub_count: number | null;
  dub_count: number | null;
  ani_description: string | null;
  ani_season: string | null;
  ani_year: number | null;
}

export interface AnimeMeta {
  malId: number;
  anilistId?: number;
  subCount: number;
  dubCount: number;
}

export interface SenshiEpisode {
  id: number | null;
  ep_id: number;
  mal_id: number | null;
  ep_title: string | null;
  ep_filler?: boolean;
  ep_recap?: boolean;
  intro_start: number | null;
  intro_end: number | null;
  outro_start: number | null;
  outro_end: number | null;
  created_at: string | null;
}

export interface EpisodeEmbed {
  id: number | null;
  public_id: string | null;
  remote_source_id: number | null;
  url: string | null;
  status: string | null;
  intro_start_ms: number | null;
  intro_end_ms: number | null;
  outro_start_ms: number | null;
  outro_end_ms: number | null;
}

export interface VidcloudEntry {
  sources: VidcloudSource[] | null;
  tracks: VidcloudTrack[] | null;
}

export interface VidcloudSource {
  src: string;
  label: string | null;
}

export interface VidcloudTrack {
  url: string | null;
  vttUrl: string | null;
  label: string | null;
}
