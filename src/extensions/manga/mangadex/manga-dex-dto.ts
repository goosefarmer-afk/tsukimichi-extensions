export type MangaDexSeries = {
  id: string;
  type: string;
  attributes: {
    title: {
      [key: string]: string;
    };
    altTitles: Array<{ [key: string]: string }>;
    description: {
      [key: string]: string;
    };
    status: string;
    contentRating: string;
    tags: {
      id: string;
      type: string;
      attributes: {
        name: {
          [key: string]: string;
        };
        group: string;
      };
      relationships: any[];
    }[];
    createdAt: string;
    updatedAt: string;
  };
  relationships: {
    id: string;
    type: string;
    attributes: {
      name: string;
      [key: string]: any;
    };
  }[];
};

export type MangaDexSeriesResponse = {
  result: string;
  response: string;
  data: MangaDexSeries;
};

export type MangaDexChapterResponse = {
  result: string;
  baseUrl: string;
  chapter: {
    hash: string;
    /**
     * High quality images
     */
    data?: string[];
    /**
     * Compressed images
     */
    dataSaver?: string[];
  };
};

export type MangaDexChaptersResponse = {
  result: string;
  response: string;
  data: {
    id: string;
    type: string;
    attributes: ChapterAttributes;
    relationships: (UserRelation | ScanlationGroupRelation)[];
  }[];
} & Pagination;

interface UserRelation {
  id: string;
  type: "user";
  attributes: UserAttributes | null;
}

interface ScanlationGroupRelation {
  id: string;
  type: "scanlation_group";
  attributes: ScanlationGroupAttributes | null;
}

interface UserAttributes {
  username: string;
}

interface ScanlationGroupAttributes {
  name: string;
}

interface ChapterAttributes {
  title: string | null;
  volume: string | null;
  chapter: string | null;
  externalUrl: string | null;
  isUnavailable: boolean;
  publishAt: string;
  readableAt: string;
  createdAt: string;
  updatedAt: string;
  translatedLanguage?: string;
}

export type MangaDexListingResponse = {
  result: string;
  response: string;
  data: MangaDexSeries[];
} & Pagination;

type Pagination = {
  limit: number;
  offset: number;
  total: number;
};
