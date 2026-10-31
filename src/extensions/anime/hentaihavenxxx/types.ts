export interface SearchResponse {
  data: {
    id: number;
    slug: string;
    title: {
      rendered: string;
    };
    meta: {
      vraven_remote_thumbnail: string | null;
    } | null;
  }[];
  totalPages: number | null;
}
