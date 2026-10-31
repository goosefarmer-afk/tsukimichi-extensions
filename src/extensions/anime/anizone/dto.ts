export interface LivewireDto {
  components: ComponentDto[];
}

export interface ComponentDto {
  snapshot: string;
  effects: EffectsDto;
}

export interface EffectsDto {
  html: string;
  dispatches: Dispatch[];
}

interface Dispatch {
  name: string;
  params?: DispatchParams | null;
}

interface DispatchParams {
  items: unknown[] | null;
  nextCursor: string | null;
  hasMore?: boolean;
}

export interface AnimeXData {
  slug: string;
  url: string;
  cover: string;
  main_title: string;
  title_set: Record<string, string>;
}

export function deserializeAnimeXData(data: any): AnimeXData {
  return {
    slug: data.slug,
    url: data.url,
    cover: data.cover,
    main_title: data.main_title,
    title_set: titleSerializer(data.title_set),
  };
}

export function titleSerializer(value: unknown): Record<string, string> {
  // PHP's empty-array-as-[] quirk
  if (Array.isArray(value)) {
    return {};
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = String(val);
    }
    return result;
  }

  return {};
}

export interface EpisodeXData {
  slug: string;
  url: string;
  title_list: Record<string, string>;
  summary: string | null;
  is_unsafe: boolean;
  type: string | null;
  air_date: string | null;
  air_diff: string | null;
  videos_count: number | null;
  duration: string | null;
  snapshot: string | null;
  teaser: string | null;
}

export interface VidStackConfig {
  src: string;
  storage: string | null;
  snapshot: string | null;
  storyboard: string | null;
  chapter: string | null;
  subtitles: VidStackSubtitle[] | null;
  fonts: string[] | null;
}

interface VidStackSubtitle {
  title: string;
  file: string;
  language: string | null;
  format: string | null;
  default?: boolean;
  forced: string | null;
}
