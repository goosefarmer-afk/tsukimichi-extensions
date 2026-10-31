export interface VideoData {
  sources: Source[];
  tracks?: Track[];
}

export interface Source {
  file: string;
  type?: string;
  label?: string;
}

export interface Track {
  file: string;
  kind: string;
}

export interface Hoster {
  hosterName: string;
  internalData: string;
}
