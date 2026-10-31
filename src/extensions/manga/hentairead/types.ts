interface Tag {
  id: number;
  text: string;
}

export interface TagResults {
  results: Tag[];
}

export interface Pages {
  data: {
    chapter: {
      images: { src: string }[];
    };
  };
}
