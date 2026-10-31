interface Source {
  file: string;
  label: string | null;
  type: string;
}

export interface DecryptedData {
  source: Source[];
}

export interface EncryptedData {
  data: string;
}
